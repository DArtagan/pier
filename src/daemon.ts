// The daemon: one Durable Harness on one storage, serving every conversation to any
// number of clients over a Unix socket (see protocol.ts).
import { existsSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { cleanupSessionResources, type Models, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	type Conversation,
	type ConversationId,
	type ConversationWatch,
	createRegistry,
	defineDoc,
	type Extension,
	Harness,
	LiveDoc,
	type LiveState,
	ProviderDoc,
	type Storage,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { createPrompt } from "./prompt.ts";
import {
	type AttachTarget,
	type ConversationSummary,
	type Event,
	type Method,
	type Methods,
	PROTOCOL_VERSION,
	type Request,
	type Response,
} from "./protocol.ts";

/**
 * The environment of the client that last attached to a conversation. Its tools run with
 * it, so a pane's devenv PATH and SSH agent reach bash. Stored, so work Durable resumes
 * after a restart runs with it too; the storage is the daemon's, in a private directory.
 */
export const ClientEnvDoc = defineDoc<{ vars: Record<string, string> }>({
	kind: "pier.client-env",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "current",
	initial: () => ({ vars: {} }),
	checkpointWhen: () => true,
});

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

export interface DaemonOptions {
	socketPath: string;
	storage: Storage;
	models: Models;
	/** What a new conversation runs with. */
	model: { provider: string; modelId: string };
	thinkingLevel?: ModelThinkingLevel;
	/** Installed after the coding tools; default pier's prompt. */
	extensions?: readonly Extension[];
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
	// First, so a second daemon gives up before it touches any storage.
	await claimSocket(options.socketPath);
	const registry = createRegistry();
	registry.install(CodingTools);
	for (const extension of options.extensions ?? [createPrompt()]) registry.install(extension);

	const harness = await Harness.open(
		options.storage,
		{
			models: options.models,
			registry,
			env: async ({ conversationId, cwd, read }, envContext) => {
				const vars = (await read.snapshot(ClientEnvDoc, conversationId, envContext))?.vars;
				return new NodeExecutionEnv({ cwd: cwd ?? homedir(), shellEnv: vars });
			},
			// A bash call batched with a write or edit runs after it, not beside it.
			settings: { toolExecution: "sequential" },
			onReport: (report) => log(`report ${report.kind}: ${String(report.error)}`),
		},
		context,
	);

	// Release a conversation's provider resources once it has been idle a while. Durable
	// never does, unlike pi when a session ends (README, "Claude, through Claude Code").
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
	harness.resume();

	const conversations = new ConversationAccess(harness, options);
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
			await Promise.all([...connections].map((connection) => connection.end("the daemon is closing")));
			for (const socket of sockets.clients) socket.close(1001, "closing");
			await new Promise<void>((resolve) => sockets.close(() => resolve()));
			await new Promise<void>((resolve) => server.close(() => resolve()));
			cleanupSessionResources();
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

/** Finding, opening and listing conversations. */
class ConversationAccess {
	readonly harness: Harness;
	readonly #options: DaemonOptions;

	constructor(harness: Harness, options: DaemonOptions) {
		this.harness = harness;
		this.#options = options;
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
				agent: { model: this.#options.model, thinkingLevel: this.#options.thinkingLevel, cwd },
				init: async (tx, id) => {
					number = assign(await tx.doc(NumbersDoc), id);
				},
			},
			context,
		);
		return { conversation, number, created: true };
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
			found.push({
				id: record.id,
				number,
				...(agent?.cwd === undefined ? {} : { cwd: agent.cwd }),
				...(text === undefined ? {} : { title: text.replace(/\s+/g, " ").slice(0, 80) }),
				busy: live?.run !== undefined,
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
	#attached: { conversation: Conversation; watch: ConversationWatch } | undefined;
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
		let request: Request;
		try {
			request = JSON.parse(data.toString()) as Request;
		} catch {
			this.#send({ id: -1, error: { message: "Not JSON" } });
			return;
		}
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
			case "submit": {
				const { text, whenBusy } = request.params;
				const submission = await this.#conversation().submit(
					{ type: "input", content: text, ...(whenBusy === undefined ? {} : { whenBusy }) },
					context,
				);
				return { submission: submission.id };
			}
			case "abort":
				await this.#conversation().abort(context);
				return {};
			case "compact":
				return { task: await this.#conversation().compact(request.params.instructions, context) };
			case "configure":
				await this.#conversation().configure(request.params, context);
				return {};
			case "entries": {
				const { limit, ...query } = request.params;
				const page = await this.#conversation().entries(query, Math.min(limit, 500), undefined, context);
				return { entries: [...page.items] };
			}
		}
	}

	async #attach(params: Methods["attach"]["params"]): Promise<Methods["attach"]["result"]> {
		await this.detach();
		const { conversation, number, created } = await this.#conversations.open(params.target, params.cwd);
		await conversation.commit(async (tx) => {
			(await tx.doc(ClientEnvDoc, conversation.id)).vars = { ...params.env };
		}, context);
		const watch = await conversation.watch(context, params.window);
		this.#attached = { conversation, watch };
		this.#send({ event: "view", conversation: conversation.id, view: watch.value });
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

function textOf(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}
