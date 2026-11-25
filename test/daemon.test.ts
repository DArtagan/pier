/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: tool commands are shell, where ${NAME:-x} is shell's */
// The daemon and its clients, over a real Unix socket, with a faux model in place of
// Claude: attach, submit, watch, several clients, the environment tools run with, abort,
// a restart, and reconnecting after one.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type Context as RequestContext,
	registerSessionResourceCleanup,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type ConversationId,
	createRegistry,
	defineExtension,
	defineTask,
	type EntryRecord,
	Harness,
	type LiveState,
	type TranscriptView,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { AttachedConversation, connectWhenUp, DaemonError, PierClient } from "../src/host/client.ts";
import { type Daemon, startDaemon } from "../src/host/daemon.ts";
import { PROTOCOL_VERSION } from "../src/host/protocol.ts";
import { findExecutable, probeLoginEnvironment } from "../src/layer/environment.ts";
import { createPrompt } from "../src/layer/prompt.ts";

// The login shell's environment, probed once: the base of every tool call's variables.
const login = await probeLoginEnvironment();
// The direnv the daemon finds: the login shell's, else the test's (devenv's, in CI).
const direnv = findExecutable("direnv", [login.PATH, process.env.PATH]) ?? "direnv";

describe("daemon", () => {
	let dir: string;
	let socketPath: string;
	let daemon: Daemon | undefined;
	const clients: PierClient[] = [];
	const faux = fauxProvider();

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "pier-daemon-"));
		socketPath = join(dir, "run", "pier.sock");
	});
	afterEach(async () => {
		for (const connected of clients.splice(0)) connected.close();
		await daemon?.close();
		daemon = undefined;
		await rm(dir, { recursive: true, force: true });
	});

	async function start(
		responses: FauxResponseStep[],
		releaseAfterMs?: number,
		environment: Partial<Parameters<typeof startDaemon>[0]["environment"]> = {},
	): Promise<void> {
		faux.setResponses(responses);
		const models = createModels();
		models.setProvider(faux.provider);
		daemon = await startDaemon({
			socketPath,
			storage: await openNodeSqliteStorage(join(dir, "pier.sqlite")),
			models,
			model: { provider: "faux", modelId: "faux-1" },
			extensions: [createPrompt({ agentDir: join(dir, "agent") })],
			environment: { login, ...environment },
			...(releaseAfterMs === undefined ? {} : { releaseAfterMs }),
		});
	}

	async function client(): Promise<{ client: PierClient; conversation: AttachedConversation }> {
		const connected = await PierClient.connect(socketPath);
		clients.push(connected);
		return { client: connected, conversation: new AttachedConversation(connected) };
	}

	/** Resolves with the first view that satisfies `predicate`. */
	function until(conversation: AttachedConversation, predicate: (view: TranscriptView) => boolean) {
		return new Promise<TranscriptView>((resolve) => {
			const stop = conversation.subscribe((view) => {
				if (!predicate(view)) return;
				queueMicrotask(() => stop());
				resolve(view);
			});
		});
	}
	/**
	 * A daemon of its own on the socket, which answers each request's text with what
	 * `answer` returns; until `stop`.
	 */
	async function fakeDaemon(answer: (request: { id: number; method: string }) => string) {
		await mkdir(join(dir, "run"), { recursive: true });
		const server = createServer();
		const sockets = new WebSocketServer({ server });
		sockets.on("connection", (socket) =>
			socket.on("message", (data) =>
				socket.send(answer(JSON.parse(data.toString()) as { id: number; method: string })),
			),
		);
		await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
		return {
			async stop() {
				for (const socket of sockets.clients) socket.terminate();
				await new Promise<void>((resolve) => sockets.close(() => resolve()));
				await new Promise<void>((resolve) => server.close(() => resolve()));
			},
		};
	}
	const entries = (view: TranscriptView): EntryRecord[] =>
		view.items.flatMap((item) => (item.kind === "entry" ? [item.entry] : []));
	const answered = (text: string) => (view: TranscriptView) =>
		entries(view).some((entry) => JSON.stringify(entry.model ?? []).includes(text));
	const idle = (view: TranscriptView) => (view.docs["pi.live"] as LiveState | undefined)?.run === undefined;

	it("answers a client, and shows the run to another client on the same conversation", async () => {
		await start([fauxAssistantMessage("Hello from faux")]);
		const first = await client();
		const { created } = await first.conversation.attach({ kind: "new" }, dir);
		expect(created).toBe(true);
		const id = first.conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		const second = await client();
		await second.conversation.attach({ kind: "id", id }, dir);
		const seen = until(second.conversation, answered("Hello from faux"));
		await first.client.request("submit", { text: "hi" });
		await until(first.conversation, answered("Hello from faux"));
		await seen;
	});

	/** The output of the first tool call a conversation in `cwd` makes, running `command`. */
	async function toolOutput(command: string, cwd = dir): Promise<string> {
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, cwd);
		await connected.request("submit", { text: "run it" });
		const view = await until(conversation, answered("done"));
		const result = entries(view).find((entry) => entry.kind === "pi.tool-result");
		return JSON.stringify(result?.model);
	}

	// The environment contract (src/layer/environment.ts): a tool call gets the login shell's
	// listed variables, the project's direnv export, pier's settings and its identity, and
	// nothing of the daemon's process or of the pane that attached.
	describe("the environment tools run with", () => {
		afterEach(() => {
			delete process.env.PIER_TEST_DAEMON_ONLY;
		});

		it("keeps out a variable set only in the daemon's process, and one a pane sends", async () => {
			// The daemon's own: what a variable inherited from the service, or an older pier's pane, would be.
			process.env.PIER_TEST_DAEMON_ONLY = "leaked";
			await start([]);
			const output = await toolOutput('echo "daemon:${PIER_TEST_DAEMON_ONLY:-absent} pane:${PIER_TEST_PANE:-absent}"');
			expect(output).toContain("daemon:absent pane:absent");
		});

		it("refuses an attach that sends an environment, as an older client would", async () => {
			await start([]);
			const { client: connected } = await client();
			await expect(
				connected.request("attach", { target: { kind: "new" }, cwd: dir, env: { PIER_TEST_PANE: "x" } } as never),
			).rejects.toThrow(/\/env unknown field/u);
		});

		it("gives the login shell's PATH and HOME, TERM=dumb, the settings, and the call's identity", async () => {
			await start([], undefined, { settings: { PAGER: "cat", PIER_TEST_SETTING: "set" } });
			const output = await toolOutput(
				'echo "path:${PATH:+set} home:$HOME term:$TERM pager:$PAGER setting:$PIER_TEST_SETTING pier:$PIER conversation:$PIER_CONVERSATION"',
			);
			expect(output).toContain(
				`path:set home:${login.HOME} term:dumb pager:cat setting:set pier:1 conversation:${hostname().split(".")[0]}#1`,
			);
		});

		it("lets the settings stand in for a base variable", async () => {
			await start([], undefined, { settings: { TERM: "xterm" } });
			expect(await toolOutput("echo term:$TERM")).toContain("term:xterm");
		});

		it("adds the project's direnv export, once its .envrc is allowed", async () => {
			// direnv keeps its allow list under XDG_DATA_HOME: the test's own, not the user's.
			const sandboxed = { ...login, XDG_DATA_HOME: join(dir, "data"), XDG_CONFIG_HOME: join(dir, "config") };
			const project = join(dir, "project");
			await mkdir(project);
			await writeFile(join(project, ".envrc"), "export PIER_TEST_PROJECT=from-envrc\n");
			await start([], undefined, { login: sandboxed });

			// Not allowed: no variable, and the model is told.
			expect(await toolOutput('echo "project:${PIER_TEST_PROJECT:-absent}"', project)).toContain("project:absent");

			const allowed = spawnSync(direnv, ["allow", project], { env: sandboxed, encoding: "utf8" });
			expect(allowed.status, allowed.stderr).toBe(0);
			// direnv's allow list is one of the files it watches: the next call evaluates again.
			expect(await toolOutput('echo "project:${PIER_TEST_PROJECT:-absent}"', project)).toContain("project:from-envrc");
		});

		it("tells the model when the project's .envrc isn't allowed", async () => {
			const sandboxed = { ...login, XDG_DATA_HOME: join(dir, "data"), XDG_CONFIG_HOME: join(dir, "config") };
			const project = join(dir, "project");
			await mkdir(project);
			await writeFile(join(project, ".envrc"), "export PIER_TEST_PROJECT=from-envrc\n");
			let prompt = "";
			await start([], undefined, { login: sandboxed });
			faux.setResponses([
				(request: RequestContext) => {
					prompt = JSON.stringify(request);
					return fauxAssistantMessage("done");
				},
			]);
			const { client: connected, conversation } = await client();
			await conversation.attach({ kind: "new" }, project);
			await connected.request("submit", { text: "hi" });
			await until(conversation, answered("done"));
			expect(prompt).toContain("hasn't been allowed");
		});

		it("gives a bash call the configured timeout when the model sets none", async () => {
			await start([], undefined, { timeoutSeconds: 0.2 });
			expect(await toolOutput("sleep 3; echo finished")).toMatch(/timed out after 0\.2 seconds/u);
		});
	});

	it("runs a batch of tool calls one at a time, so a call sees what the call before it wrote", async () => {
		// The race dotfiles' sequential-file-tools.ts closes for classic pi: a model batches a
		// change with the bash call that depends on it. The first call here is a slow bash
		// write, as a write or edit that hasn't landed yet; run beside it, the check misses it.
		await start([
			fauxAssistantMessage(
				[
					fauxToolCall("bash", { command: "sleep 0.3; echo written > batched.txt" }),
					fauxToolCall("bash", { command: "cat batched.txt 2>/dev/null || echo absent-$((1+1))" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		await connected.request("submit", { text: "write, then read" });
		const view = await until(conversation, answered("done"));
		const results = entries(view)
			.filter((entry) => entry.kind === "pi.tool-result")
			.map((entry) => JSON.stringify(entry.model));
		expect(results).toHaveLength(2);
		expect(results[1]).toContain("written");
		expect(results[1]).not.toContain("absent-2");
	});

	it("continues the newest conversation in a directory, and lists by directory", async () => {
		await start([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		const first = conversation.id;
		await connected.request("submit", { text: "first conversation" });
		await until(conversation, answered("one"));
		await conversation.attach({ kind: "new" }, join(dir, "elsewhere"));
		await connected.request("submit", { text: "second conversation" });
		await until(conversation, answered("two"));

		const { created } = await conversation.attach({ kind: "continue" }, dir);
		expect(created).toBe(false);
		expect(conversation.id).toBe(first);
		const { conversations } = await connected.request("list", { cwd: dir });
		expect(conversations.map((summary) => summary.id)).toEqual([first]);
		expect(conversations[0]?.title).toBe("first conversation");
	});

	it("numbers conversations 1, 2, 3, whatever ran in between, and opens them by number", async () => {
		await start([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		expect(conversation.number).toBe(1);
		const first = conversation.id;
		// A turn takes a dozen of Durable's ids (entries, tasks, documents) between conversations.
		await connected.request("submit", { text: "one" });
		await until(conversation, answered("first answer"));
		await conversation.attach({ kind: "new" }, dir);
		expect(conversation.number).toBe(2);
		await connected.request("submit", { text: "two" });
		await until(conversation, answered("second answer"));
		await conversation.attach({ kind: "new" }, dir);
		expect(conversation.number).toBe(3);

		await conversation.attach({ kind: "number", number: 1 }, dir);
		expect(conversation.id).toBe(first);
		await until(conversation, answered("first answer"));
		const { conversations } = await connected.request("list", { cwd: dir });
		expect(conversations.map((summary) => summary.number).sort()).toEqual([1, 2, 3]);
		await expect(conversation.attach({ kind: "number", number: 9 }, dir)).rejects.toThrow(/No conversation #9/u);
	});

	it("numbers the conversations of a store from before numbers, oldest first", async () => {
		const models = createModels();
		const storage = await openNodeSqliteStorage(join(dir, "pier.sqlite"));
		const harness = await Harness.open(storage, { models, registry: createRegistry() }, BACKGROUND_CONTEXT);
		const older = await harness.createConversation(
			{ ownership: { kind: "ownerless" }, agent: { cwd: dir } },
			BACKGROUND_CONTEXT,
		);
		const newer = await harness.createConversation(
			{ ownership: { kind: "ownerless" }, agent: { cwd: dir } },
			BACKGROUND_CONTEXT,
		);
		await harness.close(BACKGROUND_CONTEXT);

		await start([]);
		const { client: connected } = await client();
		const { conversations } = await connected.request("list", {});
		const numbers = Object.fromEntries(conversations.map((summary) => [summary.id, summary.number]));
		expect(numbers).toEqual({ [older.id]: 1, [newer.id]: 2 });
	});

	it("aborts a run that's waiting on the model", async () => {
		await start([
			(_context: RequestContext, options: SimpleStreamOptions | undefined) =>
				new Promise((resolve) => {
					options?.signal?.addEventListener("abort", () =>
						resolve(fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "aborted" })),
					);
				}),
		]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		await connected.request("submit", { text: "wait" });
		await until(conversation, (latest) => !idle(latest));
		await connected.request("abort", {});
		const view = await until(conversation, idle);
		expect((view.docs["pi.live"] as LiveState).runFailure?.reason).toBe("aborted");
	});

	it("keeps conversations across a restart", async () => {
		await start([fauxAssistantMessage("remembered")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		const id = conversation.id;
		await connected.request("submit", { text: "remember this" });
		await until(conversation, answered("remembered"));
		await daemon?.close();

		await start([]);
		const again = await client();
		await again.conversation.attach({ kind: "continue" }, dir);
		expect(again.conversation.id).toBe(id);
		await until(again.conversation, answered("remembered"));
	});

	it("reattaches after the daemon restarts, getting what it missed without a gap", async () => {
		await start([fauxAssistantMessage("before the restart")]);
		const first = await client();
		await first.conversation.attach({ kind: "new" }, dir);
		const id = first.conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		await first.client.request("submit", { text: "one" });
		await until(first.conversation, answered("before the restart"));
		await daemon?.close();
		await first.client.closed;
		// Rejected at once: ws drops a send on a closed socket, so it would otherwise never settle.
		await expect(first.client.request("list", {})).rejects.toThrow(/Not connected/u);

		// Retrying from before the new daemon is there.
		const reconnecting = connectWhenUp(socketPath, { firstDelayMs: 10, maxDelayMs: 50 });
		await start([fauxAssistantMessage("while it was away")]);
		const other = await client();
		await other.conversation.attach({ kind: "id", id }, dir);
		await other.client.request("submit", { text: "two" });
		await until(other.conversation, answered("while it was away"));

		const next = await reconnecting;
		clients.push(next);
		await first.conversation.reattach(next, dir);
		const view = await until(first.conversation, answered("while it was away"));
		expect(view.items.map((item) => item.kind)).not.toContain("gap");
		const ids = entries(view).map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(answered("before the restart")(view)).toBe(true);
		// Requests go over the new connection.
		await next.request("submit", { text: "three" });
		await until(first.conversation, (latest) => answered("three")(latest));
	});

	/** Turns `from` up to `to`, one after another, each answered: two entries a turn. */
	async function converse(connected: PierClient, conversation: AttachedConversation, from: number, to: number) {
		for (let turn = from; turn < to; turn++) {
			// biome-ignore lint/performance/noAwaitInLoops: a conversation's turns, in order
			await connected.request("submit", { text: `turn ${turn}` });
			await until(conversation, answered(`answer ${turn}`));
		}
	}
	/** Each message sent, then its answer awaited. */
	async function converse2(
		connected: PierClient,
		conversation: AttachedConversation,
		...turns: [text: string, answer: string][]
	) {
		for (const [text, answer] of turns) {
			// biome-ignore lint/performance/noAwaitInLoops: a conversation's turns, in order
			await connected.request("submit", { text });
			await until(conversation, answered(answer));
		}
	}
	const answers = (count: number) => Array.from({ length: count }, (_, turn) => fauxAssistantMessage(`answer ${turn}`));

	it("loads earlier entries page by page, until the start", async () => {
		await start(answers(80));
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		await converse(connected, conversation, 0, 80);
		const id = conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		const fresh = await client();
		await fresh.conversation.attach({ kind: "id", id }, dir);
		let view = await until(fresh.conversation, (latest) => latest.items.length > 0);
		const total = (await connected.request("entries", { limit: 500 })).entries.length;
		expect(total).toBeGreaterThan(150);
		while (view.items[0]?.kind === "earlier") {
			const before = entries(view).length;
			// biome-ignore lint/performance/noAwaitInLoops: page by page, each before the last
			await fresh.conversation.loadEarlier(BACKGROUND_CONTEXT);
			view = await until(fresh.conversation, () => true);
			expect(entries(view).length).toBeGreaterThan(before);
		}
		expect(entries(view).length).toBe(total);
	});

	it("fills the gap a long outage leaves", async () => {
		await start(answers(70));
		const first = await client();
		await first.conversation.attach({ kind: "new" }, dir);
		const id = first.conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		await converse(first.client, first.conversation, 0, 2);
		first.client.close();
		await first.client.closed;

		// More than the window holds (100) happens while it's away.
		const other = await client();
		await other.conversation.attach({ kind: "id", id }, dir);
		await converse(other.client, other.conversation, 2, 70);

		const next = await client();
		await first.conversation.reattach(next.client, dir);
		const gapped = await until(first.conversation, answered("answer 69"));
		expect(gapped.items.map((item) => item.kind)).toContain("gap");
		await first.conversation.fillGaps(BACKGROUND_CONTEXT);
		const filled = await until(first.conversation, () => true);
		expect(filled.items.map((item) => item.kind)).not.toContain("gap");
		const ids = entries(filled).map((entry) => entry.id);
		expect(ids).toEqual([...ids].sort((a, b) => a - b));
		const total = (await next.client.request("entries", { limit: 500 })).entries.length;
		expect(ids.length).toBe(total);
	});

	it("stays attached when attaching to a conversation that isn't there", async () => {
		await start([fauxAssistantMessage("still attached")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		const id = conversation.id;
		await expect(conversation.attach({ kind: "number", number: 9 }, dir)).rejects.toThrow(DaemonError);
		expect(conversation.id).toBe(id);
		await connected.request("submit", { text: "are you there" });
		await until(conversation, answered("still attached"));
	});

	it("stops reconnecting when told to, or when a daemon refuses", async () => {
		const stop = new AbortController();
		const waiting = connectWhenUp(socketPath, { signal: stop.signal, firstDelayMs: 10 });
		setTimeout(() => stop.abort(), 50);
		await expect(waiting).rejects.toMatchObject({ name: "AbortError" });

		// A daemon of another protocol version answers hello with an error.
		const fake = await fakeDaemon(({ id }) =>
			JSON.stringify({ id, error: { message: "Protocol 2 isn't 3: update pier" } }),
		);
		try {
			await expect(connectWhenUp(socketPath, { firstDelayMs: 10 })).rejects.toThrow(/update pier/u);
		} finally {
			await fake.stop();
		}
	});

	it("answers a request that isn't one with an error, and goes on serving the connection", async () => {
		await start([]);
		const socket = new WebSocket(`ws+unix://${socketPath}:/`);
		await new Promise((resolve) => socket.once("open", resolve));
		const ask = (text: string) =>
			new Promise<unknown>((resolve) => {
				socket.once("message", (data) => resolve(JSON.parse(data.toString())));
				socket.send(text);
			});
		try {
			expect(await ask("{")).toEqual({ id: -1, error: { message: "Not JSON" } });
			expect(await ask(JSON.stringify({ id: 1, method: "launch", params: {} }))).toEqual({
				id: 1,
				error: { message: expect.stringMatching(/^Not a request: \/method /u) },
			});
			const attach = { target: { kind: "number", number: 0 }, cwd: dir };
			expect(await ask(JSON.stringify({ id: 2, method: "attach", params: attach }))).toEqual({
				id: 2,
				error: { message: expect.stringMatching(/^Bad params for attach: \/target\/number /u) },
			});
			expect(await ask(JSON.stringify({ id: 3, method: "hello", params: { version: PROTOCOL_VERSION } }))).toEqual({
				id: 3,
				result: { version: PROTOCOL_VERSION, pid: process.pid },
			});
		} finally {
			socket.close();
		}
	});

	it("closes a connection whose daemon sends what isn't pier's, failing what's pending", async () => {
		const fake = await fakeDaemon(({ id, method }) =>
			method === "hello" ? JSON.stringify({ id, result: { version: PROTOCOL_VERSION, pid: 1 } }) : "<html>",
		);
		try {
			const connected = await PierClient.connect(socketPath);
			await expect(connected.request("list", {})).rejects.toThrow(/isn't one of pier's/u);
			await connected.closed;
			expect(connected.connected).toBe(false);
		} finally {
			await fake.stop();
		}
	});

	it("refuses to start with a model it can't run", async () => {
		await expect(
			startDaemon({
				socketPath,
				storage: await openNodeSqliteStorage(join(dir, "pier.sqlite")),
				models: createModels(),
				model: { provider: "faux", modelId: "faux-1" },
				environment: { login },
			}),
		).rejects.toThrow("No model faux/faux-1");
	});

	it("refuses a second daemon on the same socket", async () => {
		await start([]);
		const models = createModels();
		models.setProvider(faux.provider);
		await expect(
			startDaemon({
				socketPath,
				storage: await openNodeSqliteStorage(join(dir, "other.sqlite")),
				models,
				model: { provider: "faux", modelId: "faux-1" },
				environment: { login },
			}),
		).rejects.toThrow(/already listening/u);
	});

	it("tells a client a model's context window, for its footer", async () => {
		await start([]);
		const { client: connected } = await client();
		expect(await connected.request("model", { provider: "faux", modelId: "faux-1" })).toEqual({
			contextWindow: faux.provider.getModels()[0]?.contextWindow,
		});
		expect(await connected.request("model", { provider: "faux", modelId: "nowhere" })).toEqual({});
	});

	it("lists the models it can run, with the thinking levels each supports", async () => {
		await start([]);
		const { client: connected } = await client();
		const { models } = await connected.request("models", {});
		expect(models.map((model) => `${model.provider}/${model.id}`)).toContain("faux/faux-1");
		expect(models.every((model) => model.thinkingLevels.length > 0)).toBe(true);
	});

	it("changes a conversation's model, and clamps a thinking level the model doesn't support", async () => {
		await start([]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		// The faux model doesn't reason: every level but off is clamped to off.
		const model = (await connected.request("models", {})).models.find((each) => each.id === "faux-1");
		expect(model?.thinkingLevels).toEqual(["off"]);
		const { thinkingLevel } = await connected.request("configure", {
			model: { provider: "faux", modelId: "faux-1" },
			thinkingLevel: "high",
		});
		expect(thinkingLevel).toBe("off");
		const view = await until(
			conversation,
			(latest) => (latest.docs["pi.agent"] as { thinkingLevel?: string } | undefined)?.thinkingLevel === "off",
		);
		expect((view.docs["pi.agent"] as { model?: unknown }).model).toEqual({ provider: "faux", modelId: "faux-1" });
		await expect(connected.request("configure", { model: { provider: "faux", modelId: "nowhere" } })).rejects.toThrow(
			/No model/u,
		);
	});

	it("forks before one of your messages, keeping what came before, and lists the fork under its parent", async () => {
		await start([
			fauxAssistantMessage("first answer"),
			fauxAssistantMessage("second answer"),
			fauxAssistantMessage("branch answer"),
		]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		await converse2(connected, conversation, ["one", "first answer"], ["two", "second answer"]);
		const parent = conversation.number;
		const before = (await connected.request("entries", { limit: 50, order: "ascending" })).entries.filter(
			(entry) => entry.kind === "pi.user",
		)[1];
		if (before === undefined || parent === undefined) throw new Error("no second message");
		const { number } = await connected.request("fork", { before: before.id });
		await conversation.attach({ kind: "number", number }, dir);
		const forked = await until(conversation, answered("first answer"));
		const said = entries(forked).flatMap((entry) => (entry.kind === "pi.user" ? [JSON.stringify(entry.model)] : []));
		expect(said).toHaveLength(1);
		expect(said[0]).toContain('"one"');
		expect(answered("second answer")(forked)).toBe(false);
		await connected.request("submit", { text: "another way" });
		await until(conversation, answered("branch answer"));
		const { conversations } = await connected.request("list", {});
		const fork = conversations.find((summary) => summary.number === number);
		expect(fork?.parent?.number).toBe(parent);
		expect(fork?.branch).toBe("another way");
		expect(fork?.ownMessages).toBe(1);
		expect(conversations.find((summary) => summary.number === parent)?.parent).toBeUndefined();
	});

	it("forks before the first message as a new conversation like it", async () => {
		await start([fauxAssistantMessage("first answer")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		await converse2(connected, conversation, ["one", "first answer"]);
		const first = (await connected.request("entries", { limit: 50 })).entries.find((entry) => entry.kind === "pi.user");
		if (first === undefined) throw new Error("no message");
		const { number } = await connected.request("fork", { before: first.id });
		const parent = (await connected.request("list", {})).conversations.find(
			(summary) => summary.number === number,
		)?.parent;
		expect(parent?.number).toBe(conversation.number);
		await conversation.attach({ kind: "number", number }, dir);
		expect((await connected.request("entries", { limit: 50 })).entries).toEqual([]);
		await expect(connected.request("fork", { before: 1 as never })).rejects.toThrow(/your messages/u);
	});

	it("takes queued messages back, as pi's Alt+Up does", async () => {
		let release: (() => void) | undefined;
		await start([
			() =>
				new Promise((resolve) => {
					release = () => resolve(fauxAssistantMessage("slow answer"));
				}),
			fauxAssistantMessage("next answer"),
		]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir);
		await connected.request("submit", { text: "start" });
		await until(conversation, (latest) => !idle(latest));
		await connected.request("submit", { text: "queued one", whenBusy: "followUp" });
		await connected.request("submit", { text: "queued two", whenBusy: "followUp" });
		expect(await connected.request("dequeue", {})).toEqual({ texts: ["queued one", "queued two"] });
		expect(await connected.request("dequeue", {})).toEqual({ texts: [] });
		release?.();
		const view = await until(conversation, (latest) => idle(latest) && answered("slow answer")(latest));
		expect(answered("queued one")(view)).toBe(false);
	});

	// pi-claude-code keeps a warm Claude Code per conversation until pi-ai's
	// `cleanupSessionResources()` names its provider session (README, "Claude, through
	// Claude Code"). The daemon releases it once the conversation idles; Durable releases
	// every conversation's when the Harness closes.
	describe("provider resources", () => {
		const released: (string | undefined)[] = [];
		let unregister: (() => void) | undefined;
		beforeEach(() => {
			released.length = 0;
			unregister = registerSessionResourceCleanup((sessionId) => released.push(sessionId));
		});
		afterEach(() => unregister?.());

		/** The provider session id of the conversation in `view`. */
		const sessionOf = (view: TranscriptView) =>
			(view.docs["pi.provider"] as { sessionId?: string } | undefined)?.sessionId;

		async function answeredOnce(): Promise<string> {
			const { client: connected, conversation } = await client();
			await conversation.attach({ kind: "new" }, dir);
			await connected.request("submit", { text: "hi" });
			const view = await until(conversation, (latest) => idle(latest) && answered("answer")(latest));
			const sessionId = sessionOf(view);
			if (sessionId === undefined) throw new Error("no provider session id");
			return sessionId;
		}

		it("releases a conversation's once it has been idle a while", async () => {
			await start([fauxAssistantMessage("answer")], 50);
			const sessionId = await answeredOnce();
			await expect.poll(() => released, { timeout: 2000 }).toContain(sessionId);
		});

		it("releases every conversation's when the daemon closes", async () => {
			await start([fauxAssistantMessage("answer")]);
			const sessionId = await answeredOnce();
			expect(released).toEqual([]);
			await daemon?.close();
			daemon = undefined;
			expect(released).toContain(sessionId);
		});
	});

	// Durable blocks a task no installed definition can take: written by a newer Durable
	// (`task_too_old`), or whose code is gone (`missing_task`). Its conversation waits for
	// it, so the client must say so, and Esc must end it.
	describe("blocked tasks", () => {
		// Never installed in the daemon's registry, so Durable has no code for it.
		const Uninstalled = defineTask<null, { phase: "run" }, null>({
			name: "test.uninstalled",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: { run: async () => {} },
			abort: async () => {},
		});
		const blockIn = (id: ConversationId, background = false) =>
			daemon?.harness.commit(
				(tx) =>
					tx.createTask(Uninstalled, null, {
						ownership: { kind: "conversation" },
						conversationId: id,
						...(background ? { background } : {}),
					}),
				BACKGROUND_CONTEXT,
			);

		it("tells the attached client, says so in the list, and Esc ends it", async () => {
			await start([]);
			const { client: connected, conversation } = await client();
			await conversation.attach({ kind: "new" }, dir);
			const id = conversation.id;
			if (id === undefined) throw new Error("attached without an id");
			expect(conversation.blocked).toEqual([]);
			const task = await blockIn(id);
			await expect.poll(() => conversation.blocked.map((blocked) => blocked.id)).toEqual([task]);
			expect(conversation.blocked[0]).toMatchObject({
				kind: "test.uninstalled",
				reason: "missing_task",
				background: false,
			});
			const listed = (await connected.request("list", {})).conversations.find((summary) => summary.id === id);
			expect(listed?.blocked).toBe(true);

			await connected.request("abort", {});
			await expect.poll(() => conversation.blocked).toEqual([]);
			const after = (await connected.request("list", {})).conversations.find((summary) => summary.id === id);
			expect(after?.blocked).toBeUndefined();
			const ended = await daemon?.harness.getTask(task as never, BACKGROUND_CONTEXT);
			expect(ended?.state).toMatchObject({ status: "terminal", outcome: { status: "orphaned" } });
		});

		it("tells a client that attaches after the task was blocked, as at a daemon's start", async () => {
			await start([]);
			const first = await client();
			await first.conversation.attach({ kind: "new" }, dir);
			const id = first.conversation.id;
			if (id === undefined) throw new Error("attached without an id");
			await blockIn(id);
			await expect.poll(() => first.conversation.blocked.length).toBe(1);
			await daemon?.close();

			// The task is in the store; a new daemon finds it blocked as it opens.
			const logged: string[] = [];
			const models = createModels();
			models.setProvider(faux.provider);
			daemon = await startDaemon({
				socketPath,
				storage: await openNodeSqliteStorage(join(dir, "pier.sqlite")),
				models,
				model: { provider: "faux", modelId: "faux-1" },
				extensions: [createPrompt({ agentDir: join(dir, "agent") })],
				environment: { login },
				log: (message) => logged.push(message),
			});
			expect(logged.some((line) => /blocked: missing_task/u.test(line))).toBe(true);
			const again = await client();
			await again.conversation.attach({ kind: "id", id }, dir);
			await expect.poll(() => again.conversation.blocked.map((task) => task.reason)).toEqual(["missing_task"]);
		});

		// Durable's remedy: the task waits, unchanged, and runs on once code that fits is there.
		it("runs on, unblocked, once the daemon has the task's code", async () => {
			await start([]);
			const first = await client();
			await first.conversation.attach({ kind: "new" }, dir);
			const id = first.conversation.id;
			if (id === undefined) throw new Error("attached without an id");
			const task = await blockIn(id);
			await expect.poll(() => first.conversation.blocked.length).toBe(1);
			await daemon?.close();

			const Installed = defineTask<null, { phase: "run" }, null>({
				name: "test.uninstalled",
				version: 1,
				initial: () => ({ phase: "run" }),
				phases: {
					run: (_task, runtime, ctx) =>
						runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx),
				},
				abort: async () => {},
			});
			const models = createModels();
			models.setProvider(faux.provider);
			daemon = await startDaemon({
				socketPath,
				storage: await openNodeSqliteStorage(join(dir, "pier.sqlite")),
				models,
				model: { provider: "faux", modelId: "faux-1" },
				extensions: [
					createPrompt({ agentDir: join(dir, "agent") }),
					defineExtension({ name: "test.tasks", tasks: [Installed] }),
				],
				environment: { login },
			});
			const again = await client();
			await again.conversation.attach({ kind: "id", id }, dir);
			const done = await daemon.harness.waitForTask(task as never, BACKGROUND_CONTEXT);
			expect(done.state.outcome.status).toBe("completed");
			await expect.poll(() => again.conversation.blocked).toEqual([]);
		});

		it("tells of a blocked background task, without marking the conversation blocked", async () => {
			await start([]);
			const { client: connected, conversation } = await client();
			await conversation.attach({ kind: "new" }, dir);
			const id = conversation.id;
			if (id === undefined) throw new Error("attached without an id");
			await blockIn(id, true);
			await expect.poll(() => conversation.blocked.map((task) => task.background)).toEqual([true]);
			const listed = (await connected.request("list", {})).conversations.find((summary) => summary.id === id);
			expect(listed?.blocked).toBeUndefined();
		});

		it("doesn't tell a client attached to another conversation", async () => {
			await start([]);
			const stuck = await client();
			await stuck.conversation.attach({ kind: "new" }, dir);
			const other = await client();
			await other.conversation.attach({ kind: "new" }, dir);
			const id = stuck.conversation.id;
			if (id === undefined) throw new Error("attached without an id");
			await blockIn(id);
			await expect.poll(() => stuck.conversation.blocked.length).toBe(1);
			expect(other.conversation.blocked).toEqual([]);
		});
	});

	it("rejects requests before attaching", async () => {
		await start([]);
		const { client: connected } = await client();
		await expect(connected.request("submit", { text: "hi" })).rejects.toThrow(/Not attached/u);
	});
});
