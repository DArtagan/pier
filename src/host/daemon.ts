// The daemon: one Durable Harness on one storage, serving every conversation to any
// number of clients over a Unix socket (see protocol.ts).
import { existsSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { homedir, hostname } from "node:os";
import { dirname } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	clampThinkingLevel,
	cleanupSessionResources,
	getSupportedThinkingLevels,
	type Models,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import {
	AgentDoc,
	type Conversation,
	type ConversationId,
	type ConversationInit,
	type ConversationWatch,
	createRegistry,
	defineDoc,
	type EntryId,
	type Extension,
	Harness,
	InboxDoc,
	LiveDoc,
	type LiveState,
	ProviderDoc,
	type Storage,
	type TaskGraph,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { ConversationDirectories } from "../layer/claude-code.ts";
import { type EnvironmentOptions, ToolEnvironment } from "../layer/environment.ts";
import { createPrompt } from "../layer/prompt.ts";
import { createSkills } from "../layer/skills.ts";
import {
	type AttachTarget,
	type BlockedTask,
	type ConversationSummary,
	DAEMON_CLOSING,
	type Event,
	type Method,
	type Methods,
	type ModelSummary,
	PROTOCOL_VERSION,
	parseRequest,
	type Request,
	type Response,
} from "./protocol.ts";

/**
 * The numbers pier gives conversations, #1, #2, … on this host, by number. Durable's own
 * conversation ids come from one counter shared with every entry, task and document, so
 * the second conversation can be #47. A number is assigned in the commit that creates
 * its conversation.
 */
export const NumbersDoc = defineDoc<{ last: number; conversations: Record<string, number> }>({
	kind: "pier.numbers",
	version: 1,
	scope: "session",
	initial: () => ({ last: 0, conversations: {} }),
	// A base now and then, so a read replays a bounded number of changes.
	checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 64,
});

/**
 * Where a conversation was forked from, by pier's `fork`: the conversation, and the user
 * message the fork went back to before. Durable records a fork's parent too, but a fork
 * from before the first message is a new conversation Durable doesn't link to anything.
 */
export const ForkDoc = defineDoc<{ from?: ConversationId; before?: EntryId }>({
	kind: "pier.fork",
	version: 1,
	scope: "conversation",
	history: "latest",
	// A fork's own fork records its own parent, not its parent's.
	fork: "initial",
	initial: () => ({}),
	checkpointWhen: () => true,
});

export interface DaemonOptions {
	socketPath: string;
	storage: Storage;
	models: Models;
	/** What a new conversation runs with. */
	model: { provider: string; modelId: string };
	thinkingLevel?: ModelThinkingLevel;
	/** Installed after the coding tools; default pier's prompt, and projects' skills only. */
	extensions?: readonly Extension[];
	/**
	 * What tool calls run with (`src/layer/environment.ts`), less the conversation's name,
	 * which the daemon gives as `<host>#<number>`. `login` is the login shell's environment.
	 */
	environment: Omit<EnvironmentOptions, "name" | "log">;
	/**
	 * How long a conversation is idle before its provider's per-session resources (such
	 * as pi-claude-code's warm Claude Code process) are released. Default 5 minutes.
	 */
	releaseAfterMs?: number;
	log?: (message: string) => void;
}

export interface Daemon {
	readonly harness: Harness;
	/** Settles when the Harness closes, by `close()` or after a storage failure. */
	readonly closed: Promise<void>;
	close(): Promise<void>;
}

const context: Context = BACKGROUND_CONTEXT;

export async function startDaemon(options: DaemonOptions): Promise<Daemon> {
	const log = options.log ?? (() => {});
	const model = options.model;
	if (options.models.getModel(model.provider, model.modelId) === undefined) {
		throw new Error(`No model ${model.provider}/${model.modelId}`);
	}
	// Before any storage, so a second daemon gives up before it touches it.
	await claimSocket(options.socketPath);
	const registry = createRegistry();
	// Durable's coding tools, with bash under the environment contract: a call gets only the
	// contract's variables, never the daemon's or a pane's.
	const host = hostname().split(".")[0] ?? "pier";
	const environment = new ToolEnvironment({
		...options.environment,
		name: async (conversationId, read, nameContext) => {
			const numbers = await read.snapshot(NumbersDoc, nameContext);
			const found = Object.entries(numbers?.conversations ?? {}).find(([, id]) => id === conversationId);
			return found === undefined ? undefined : `${host}#${found[0]}`;
		},
		log,
	});
	registry.install(environment.tools());
	log(`projects' environments: ${environment.projects.direnv ?? "no direnv, so none"}`);
	// pi-claude-code runs Claude Code in the directory this records for each conversation.
	registry.install(ConversationDirectories);
	for (const extension of options.extensions ?? [createPrompt(), createSkills()]) registry.install(extension);
	registry.install(environment.section());

	const harness = await Harness.open(
		options.storage,
		{
			models: options.models,
			registry,
			// No `shellEnv`: bash's calls get their variables from the contract (above).
			env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? homedir() }),
			// A bash call batched with a write or edit runs after it, not beside it.
			settings: { toolExecution: "sequential" },
			onReport: (report) => log(`report ${report.kind}: ${String(report.error)}`),
		},
		context,
	);

	// Release a conversation's provider resources once it has been idle a while. Durable
	// releases them only when the Harness closes, where pi does when a session ends
	// (README, "Claude, through Claude Code"). Workaround: an idle release in Durable (it
	// already has `settings.contextRetentionMs` for idle contexts) would replace this.
	const releaseAfterMs = options.releaseAfterMs ?? 5 * 60_000;
	const releases = new Map<ConversationId, NodeJS.Timeout>();
	const release = async (conversationId: ConversationId) => {
		releases.delete(conversationId);
		const live = await harness.snapshot(LiveDoc, conversationId, context);
		if (live?.run !== undefined) return;
		const provider = await harness.snapshot(ProviderDoc, conversationId, context);
		if (provider === undefined) return;
		log(`releasing provider resources of conversation ${conversationId}`);
		cleanupSessionResources(provider.sessionId);
	};
	const runs = harness.observeCommits({
		advance: (publication) => {
			for (const change of publication.changes) {
				if (change.type !== "document" || change.record.kind !== LiveDoc.definition.kind) continue;
				const conversationId = change.conversationId;
				if (conversationId === undefined) continue;
				const running = change.kind === "change" && (change.value as LiveState).run !== undefined;
				clearTimeout(releases.get(conversationId));
				releases.delete(conversationId);
				if (!running)
					releases.set(
						conversationId,
						setTimeout(() => void release(conversationId), releaseAfterMs),
					);
			}
		},
		end: () => {},
	});
	// Durable's task graph says which tasks it can't run, and follows the registry: a task
	// can be blocked at open (written by a newer Durable) or at any time after.
	const blocked = new BlockedTasks(log);
	const graph = await harness.watchTaskGraph(context);
	blocked.update(graph.value);
	graph.start(async (call) => {
		if (call.kind === "value") blocked.update(call.value);
	});
	harness.resume();

	const conversations = new ConversationAccess(harness, options, blocked);
	await conversations.numberAll();
	const connections = new Set<Connection>();
	const server = createServer((_request, response) => {
		response.writeHead(426, { "content-type": "text/plain" });
		response.end("pier speaks WebSocket\n");
	});
	const sockets = new WebSocketServer({ server, maxPayload: 64 * 1024 * 1024 });
	sockets.on("connection", (socket) => {
		const connection = new Connection(socket, conversations, log);
		connections.add(connection);
		socket.on("close", () => {
			connections.delete(connection);
			void connection.detach();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.socketPath, () => resolve());
	});
	await chmod(options.socketPath, 0o600);
	log(`listening on ${options.socketPath}`);

	let closing: Promise<void> | undefined;
	const close = () => {
		closing ??= (async () => {
			for (const timer of releases.values()) clearTimeout(timer);
			releases.clear();
			runs.detach();
			await graph.stop();
			await Promise.all([...connections].map((connection) => connection.end(DAEMON_CLOSING)));
			for (const socket of sockets.clients) socket.close(1001, "closing");
			await new Promise<void>((resolve) => sockets.close(() => resolve()));
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await harness.close(context);
			await rm(options.socketPath, { force: true });
		})();
		return closing;
	};
	const closed = harness.closed.then(async (end) => {
		if (end.kind === "failed") {
			log(`the Harness failed: ${String(end.error)}`);
			await close();
		}
	});
	return { harness, closed, close };
}

/** Take the socket path: refuse one a live daemon answers on, clear a stale one. */
async function claimSocket(path: string): Promise<void> {
	// A directory this creates is private; an existing one is left as it is (it may be
	// /tmp). The socket itself is made 0600 once it exists.
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	if (!existsSync(path)) return;
	const live = await new Promise<boolean>((resolve) => {
		const probe = connect(path);
		probe.once("connect", () => {
			probe.destroy();
			resolve(true);
		});
		probe.once("error", () => resolve(false));
	});
	if (live) throw new Error(`A pier daemon is already listening on ${path}`);
	await rm(path, { force: true });
}

/** Each conversation's tasks that Durable can't run, from its task graph, for clients to show. */
class BlockedTasks {
	readonly #by = new Map<ConversationId, readonly BlockedTask[]>();
	readonly #listeners = new Set<(conversation: ConversationId) => void>();
	readonly #log: (message: string) => void;

	constructor(log: (message: string) => void) {
		this.#log = log;
	}

	of(conversation: ConversationId): readonly BlockedTask[] {
		return this.#by.get(conversation) ?? [];
	}

	/** Call `listener` with each conversation whose blocked tasks change, until the returned function. */
	subscribe(listener: (conversation: ConversationId) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	update(graph: TaskGraph): void {
		const next = new Map<ConversationId, BlockedTask[]>();
		for (const node of Object.values(graph.tasks)) {
			if (node.blocked === undefined) continue;
			const tasks = next.get(node.conversationId) ?? [];
			tasks.push({ id: node.id, kind: node.kind, reason: node.blocked, background: node.background });
			next.set(node.conversationId, tasks);
		}
		const changed = new Set([...this.#by.keys(), ...next.keys()]);
		for (const conversation of changed) {
			const before = this.of(conversation);
			const after = next.get(conversation) ?? [];
			if (JSON.stringify(before) === JSON.stringify(after)) changed.delete(conversation);
			else this.#logChange(conversation, before, after);
		}
		this.#by.clear();
		for (const [conversation, tasks] of next) this.#by.set(conversation, tasks);
		for (const conversation of changed) for (const listener of this.#listeners) listener(conversation);
	}

	#logChange(conversation: ConversationId, before: readonly BlockedTask[], after: readonly BlockedTask[]): void {
		const ids = new Set(before.map((task) => task.id));
		for (const task of after) {
			if (!ids.has(task.id)) {
				const background = task.background ? "background " : "";
				this.#log(
					`${background}task ${task.id} (${task.kind}) of conversation ${conversation} is blocked: ${task.reason}`,
				);
			}
		}
		const still = new Set(after.map((task) => task.id));
		for (const task of before) {
			if (!still.has(task.id))
				this.#log(`task ${task.id} (${task.kind}) of conversation ${conversation} is no longer blocked`);
		}
	}
}

/** Finding, opening and listing conversations. */
class ConversationAccess {
	readonly harness: Harness;
	readonly blocked: BlockedTasks;
	readonly #options: DaemonOptions;

	constructor(harness: Harness, options: DaemonOptions, blocked: BlockedTasks) {
		this.harness = harness;
		this.blocked = blocked;
		this.#options = options;
	}

	get models(): Models {
		return this.#options.models;
	}

	async open(
		target: AttachTarget,
		cwd: string,
	): Promise<{ conversation: Conversation; number: number; created: boolean }> {
		if (target.kind === "id" || target.kind === "number") {
			const numbers = await this.#numbers();
			const id =
				target.kind === "id" ? target.id : (numbers.conversations[target.number] as ConversationId | undefined);
			const number = target.kind === "number" ? target.number : this.#numberOf(numbers, target.id);
			const conversation = id === undefined ? undefined : await this.harness.conversation(id, context);
			if (conversation === undefined || number === undefined) {
				throw new Error(`No conversation ${target.kind === "number" ? `#${target.number}` : target.id}`);
			}
			return { conversation, number, created: false };
		}
		if (target.kind === "continue") {
			const newest = (await this.list({ cwd, limit: 1 }))[0];
			if (newest !== undefined) return this.open({ kind: "id", id: newest.id }, cwd);
		}
		let number = 0;
		const conversation = await this.harness.createConversation(
			{
				ownership: { kind: "ownerless" },
				agent: {
					model: this.#options.model,
					...(this.#options.thinkingLevel === undefined ? {} : { thinkingLevel: this.#options.thinkingLevel }),
					cwd,
				},
				init: async (tx, id) => {
					number = assign(await tx.doc(NumbersDoc), id);
				},
			},
			context,
		);
		return { conversation, number, created: true };
	}

	/**
	 * A new conversation whose history is `conversation`'s up to just before its user message
	 * `before`, numbered as any other. Durable forks *at* an entry, the last one the fork
	 * keeps, so this forks at the entry before; before the first message there's none, and
	 * the result is a new conversation with the same model, thinking level and directory.
	 */
	async fork(conversation: Conversation, before: EntryId): Promise<number> {
		const message = (await conversation.entries({ minEntryId: before, maxEntryId: before }, 1, undefined, context))
			.items[0];
		if (message?.kind !== "pi.user") throw new Error("Forks start at one of your messages");
		const previous = (await conversation.entries({ maxEntryId: (before - 1) as EntryId }, 1, undefined, context))
			.items[0];
		let number = 0;
		const init: ConversationInit = async (tx, id) => {
			number = assign(await tx.doc(NumbersDoc), id);
			const fork = await tx.doc(ForkDoc, id);
			fork.from = conversation.id;
			fork.before = before;
		};
		if (previous === undefined) {
			const agent = await this.harness.snapshot(AgentDoc, conversation.id, context);
			await this.harness.createConversation(
				{
					ownership: { kind: "ownerless" },
					agent: {
						...(agent?.model === undefined ? {} : { model: agent.model }),
						...(agent?.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
						...(agent?.cwd === undefined ? {} : { cwd: agent.cwd }),
					},
					init,
				},
				context,
			);
		} else {
			await conversation.fork(previous.id, { ownership: { kind: "ownerless" }, init }, context);
		}
		return number;
	}

	/**
	 * Withdraw `conversation`'s queued messages, steering and follow-ups, and return the text
	 * of those withdrawn, oldest first. One a run took in meanwhile isn't withdrawn, and
	 * isn't returned.
	 */
	async dequeue(conversation: Conversation): Promise<string[]> {
		const inbox = await this.harness.snapshot(InboxDoc, conversation.id, context);
		const texts: string[] = [];
		for (const item of inbox?.items ?? []) {
			if (item.mode === "write") continue;
			// biome-ignore lint/performance/noAwaitInLoops: oldest first, a handful at most, on synchronous storage (see `list`)
			const submission = await this.harness.submission(item.id, context);
			if ((await submission?.abort(context)) !== "aborted") continue;
			const text = textOf(item.content as string | readonly { type: string; text?: string }[]);
			if (text.trim() !== "") texts.push(text);
		}
		return texts;
	}

	/** The models the daemon can run, for the client's pickers. */
	async availableModels(): Promise<ModelSummary[]> {
		const models = await this.models.getAvailable();
		return models.map((model) => ({
			provider: model.provider,
			id: model.id,
			...(model.name === undefined || model.name === model.id ? {} : { name: model.name }),
			thinkingLevels: getSupportedThinkingLevels(model),
		}));
	}

	/**
	 * Change `conversation`'s model or thinking level. The thinking level is clamped to what
	 * the model (the new one, if it changes) supports, as pi clamps it.
	 */
	async configure(
		conversation: Conversation,
		change: Methods["configure"]["params"],
	): Promise<Methods["configure"]["result"]> {
		const agent = await this.harness.snapshot(AgentDoc, conversation.id, context);
		const ref = change.model ?? agent?.model ?? this.#options.model;
		const model = this.models.getModel(ref.provider, ref.modelId);
		if (change.model !== undefined && model === undefined) {
			throw new Error(`No model ${change.model.provider}/${change.model.modelId}`);
		}
		const requested = change.thinkingLevel ?? agent?.thinkingLevel ?? this.#options.thinkingLevel;
		const thinkingLevel =
			requested === undefined || model === undefined ? requested : clampThinkingLevel(model, requested);
		await conversation.configure(
			{
				...(change.model === undefined ? {} : { model: { ...change.model } }),
				...(thinkingLevel === undefined ||
				(change.thinkingLevel === undefined && thinkingLevel === agent?.thinkingLevel)
					? {}
					: { thinkingLevel }),
			},
			context,
		);
		return thinkingLevel === undefined ? {} : { thinkingLevel };
	}

	/** Number the top-level conversations that have no number yet, oldest first: those of a store from before numbers. */
	async numberAll(): Promise<void> {
		await this.harness.commit(async (tx) => {
			const numbers = await tx.doc(NumbersDoc);
			const numbered = new Set(Object.values(numbers.conversations));
			const records = await tx.scanConversations({ order: "ascending" }, 10_000);
			for (const record of records.items) {
				if (record.owner === undefined && !numbered.has(record.id)) assign(numbers, record.id);
			}
		}, context);
	}

	async #numbers(): Promise<Readonly<{ last: number; conversations: Record<string, number> }>> {
		return (await this.harness.snapshot(NumbersDoc, context)) ?? NumbersDoc.definition.initial();
	}

	#numberOf(numbers: { conversations: Record<string, number> }, id: ConversationId): number | undefined {
		const found = Object.entries(numbers.conversations).find(([, conversation]) => conversation === id);
		return found === undefined ? undefined : Number(found[0]);
	}

	/** Top-level conversations, most recently active first. */
	async list(filter: { cwd?: string; limit?: number }): Promise<ConversationSummary[]> {
		const records = await this.harness.commit((tx) => tx.scanConversations({ order: "descending" }, 500), context);
		const numbers = await this.#numbers();
		const byId = new Map(Object.entries(numbers.conversations).map(([number, id]) => [id, Number(number)]));
		const found: (ConversationSummary & { activity: number })[] = [];
		for (const record of records.items) {
			// Subagents' conversations belong to their task, not to a person, and have no number.
			const number = byId.get(record.id);
			if (record.owner !== undefined || number === undefined) continue;
			// One at a time. The storage answers synchronously, so in parallel there's nothing to
			// overlap: 500 conversations listed in 27 ms that way, 25 ms like this.
			// biome-ignore lint/performance/noAwaitInLoops: measured no faster in parallel (above)
			const agent = await this.harness.snapshot(AgentDoc, record.id, context);
			if (filter.cwd !== undefined && agent?.cwd !== filter.cwd) continue;
			const conversation = await this.harness.conversation(record.id, context);
			if (conversation === undefined) continue;
			const newest = (await conversation.entries({}, 1, undefined, context)).items[0];
			const first = (await conversation.entries({ order: "ascending" }, 8, undefined, context)).items.find(
				(entry) => entry.kind === "pi.user",
			);
			const message = first?.model?.[0];
			const text = message?.role === "user" ? textOf(message.content) : undefined;
			const live = await this.harness.snapshot(LiveDoc, record.id, context);
			// pier's record of the fork first: Durable has none for a fork from before the first message.
			const fork = await this.harness.snapshot(ForkDoc, record.id, context);
			const from = fork?.from ?? record.parent?.conversationId;
			const parent = from === undefined ? undefined : byId.get(from);
			// A fork's own messages, after those it shares with its parent: what sets it apart.
			const own =
				record.parent === undefined && fork?.from === undefined
					? undefined
					: await ownMessages(conversation, record.id);
			const newestText = await newestMessage(conversation);
			found.push({
				id: record.id,
				number,
				...(parent === undefined ? {} : { parent: { number: parent } }),
				...(own?.first === undefined ? {} : { branch: oneLine(own.first) }),
				...(newestText === undefined ? {} : { latest: oneLine(newestText.text), active: newestText.timestamp }),
				...(own === undefined ? {} : { ownMessages: own.count }),
				...(agent?.cwd === undefined ? {} : { cwd: agent.cwd }),
				...(text === undefined ? {} : { title: text.replace(/\s+/gu, " ").slice(0, 80) }),
				busy: live?.run !== undefined,
				// A blocked background task doesn't hold the conversation, so it isn't stuck.
				...(this.blocked.of(record.id).some((task) => !task.background) ? { blocked: true } : {}),
				activity: Number(newest?.id ?? record.id),
			});
		}
		found.sort((a, b) => b.activity - a.activity);
		return found.slice(0, filter.limit ?? 50).map(({ activity: _activity, ...summary }) => summary);
	}
}

/** Give conversation `id` the next number. */
function assign(numbers: { last: number; conversations: Record<string, number> }, id: ConversationId): number {
	numbers.last += 1;
	numbers.conversations[numbers.last] = id;
	return numbers.last;
}

/** One client connection, attached to at most one conversation at a time. */
class Connection {
	#attached: { conversation: Conversation; watch: ConversationWatch; unfollowBlocked: () => void } | undefined;
	readonly #socket: WebSocket;
	readonly #conversations: ConversationAccess;
	readonly #log: (message: string) => void;

	constructor(socket: WebSocket, conversations: ConversationAccess, log: (message: string) => void) {
		this.#socket = socket;
		this.#conversations = conversations;
		this.#log = log;
		socket.on("message", (data) => void this.#receive(data));
	}

	async #receive(data: RawData): Promise<void> {
		let message: unknown;
		try {
			message = JSON.parse(data.toString());
		} catch {
			this.#send({ id: -1, error: { message: "Not JSON" } });
			return;
		}
		const parsed = parseRequest(message);
		if ("error" in parsed) {
			this.#send({ id: parsed.id, error: { message: parsed.error } });
			return;
		}
		const { request } = parsed;
		try {
			const result = await this.#handle(request);
			this.#send({ id: request.id, result });
		} catch (error) {
			this.#send({ id: request.id, error: { message: error instanceof Error ? error.message : String(error) } });
		}
	}

	async #handle(request: Request): Promise<Methods[Method]["result"]> {
		switch (request.method) {
			case "hello":
				if (request.params.version !== PROTOCOL_VERSION) {
					throw new Error(`Protocol ${request.params.version} isn't ${PROTOCOL_VERSION}: update pier`);
				}
				return { version: PROTOCOL_VERSION, pid: process.pid };
			case "attach":
				return this.#attach(request.params);
			case "detach":
				await this.detach();
				return {};
			case "list":
				return { conversations: await this.#conversations.list(request.params) };
			case "model": {
				const { provider, modelId } = request.params;
				const contextWindow = this.#conversations.models.getModel(provider, modelId)?.contextWindow;
				return contextWindow === undefined ? {} : { contextWindow };
			}
			case "submit": {
				const { text, whenBusy } = request.params;
				const submission = await this.#conversation().submit(
					{ type: "input", content: text, ...(whenBusy === undefined ? {} : { whenBusy }) },
					context,
				);
				return { submission: submission.id };
			}
			case "dequeue":
				return { texts: await this.#conversations.dequeue(this.#conversation()) };
			case "abort":
				// It ends an ordinary blocked task too: Durable orphans an aborted task it can't run.
				await this.#conversation().abort(context);
				return {};
			case "compact":
				return { task: await this.#conversation().compact(request.params.instructions, context) };
			case "configure":
				return this.#conversations.configure(this.#conversation(), request.params);
			case "models":
				return { models: await this.#conversations.availableModels() };
			case "fork":
				return { number: await this.#conversations.fork(this.#conversation(), request.params.before) };
			case "entries": {
				const { limit, ...query } = request.params;
				const page = await this.#conversation().entries(query, Math.min(limit, 500), undefined, context);
				return { entries: [...page.items], ...(page.next === undefined ? {} : { next: page.next }) };
			}
		}
	}

	async #attach(params: Methods["attach"]["params"]): Promise<Methods["attach"]["result"]> {
		// Opened before the old view is let go, so a target that isn't there leaves it attached.
		const { conversation, number, created } = await this.#conversations.open(params.target, params.cwd);
		await this.detach();
		const watch = await conversation.watch(context, params.window);
		const sendBlocked = () =>
			this.#send({
				event: "blocked",
				conversation: conversation.id,
				tasks: this.#conversations.blocked.of(conversation.id),
			});
		const unfollowBlocked = this.#conversations.blocked.subscribe((changed) => {
			if (changed === conversation.id && this.#attached?.watch === watch) sendBlocked();
		});
		this.#attached = { conversation, watch, unfollowBlocked };
		this.#send({ event: "view", conversation: conversation.id, view: watch.value });
		// After the view: the client follows a conversation from its view on.
		sendBlocked();
		watch.start(async (call) => {
			if (call.kind === "value" && call.ops.length > 0) {
				this.#send({ event: "ops", conversation: conversation.id, ops: call.ops });
			}
		});
		void watch.closed.then((end) => {
			if (this.#attached?.watch !== watch || end.kind === "stopped") return;
			this.#log(`watch of conversation ${conversation.id} ended: ${end.kind}`);
			this.#send({ event: "ended", conversation: conversation.id, reason: end.kind });
		});
		return { conversation: conversation.id, number, created };
	}

	#conversation(): Conversation {
		if (this.#attached === undefined) throw new Error("Not attached to a conversation");
		return this.#attached.conversation;
	}

	async detach(): Promise<void> {
		const attached = this.#attached;
		this.#attached = undefined;
		attached?.unfollowBlocked();
		await attached?.watch.stop();
	}

	/** Tell the client its view ends, and stop following it. */
	async end(reason: string): Promise<void> {
		const attached = this.#attached;
		if (attached !== undefined) this.#send({ event: "ended", conversation: attached.conversation.id, reason });
		await this.detach();
	}

	#send(message: Response | Event): void {
		if (this.#socket.readyState === this.#socket.OPEN) this.#socket.send(JSON.stringify(message));
	}
}

/** A message on one line, cut short, for a listing. */
function oneLine(text: string): string {
	return text.replace(/\s+/gu, " ").trim().slice(0, 80);
}

/**
 * The user messages a fork has of its own, after those it shares with its parent: its
 * first, and how many. Ids come from one counter, so its own entries are those after its id.
 */
async function ownMessages(conversation: Conversation, id: ConversationId): Promise<{ first?: string; count: number }> {
	const page = await conversation.entries(
		{ minEntryId: id as unknown as EntryId, order: "ascending" },
		500,
		undefined,
		context,
	);
	const texts = page.items.flatMap((entry) => {
		const message = entry.kind === "pi.user" ? entry.model?.[0] : undefined;
		return message?.role === "user" ? [textOf(message.content)] : [];
	});
	return { ...(texts[0] === undefined ? {} : { first: texts[0] }), count: texts.length };
}

/** The newest user message, and when the newest message of any kind was sent. */
async function newestMessage(conversation: Conversation): Promise<{ text: string; timestamp?: number } | undefined> {
	const page = await conversation.entries({}, 30, undefined, context);
	const timestamp = page.items.map((entry) => entry.model?.[0]?.timestamp).find((time) => typeof time === "number");
	for (const entry of page.items) {
		const message = entry.kind === "pi.user" ? entry.model?.[0] : undefined;
		if (message?.role === "user")
			return { text: textOf(message.content), ...(timestamp === undefined ? {} : { timestamp }) };
	}
	return undefined;
}

function textOf(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}
