// The daemon and its clients, over a real Unix socket, with a faux model in place of
// Claude: attach, submit, watch, several clients, the client's environment, abort, a
// restart, and reconnecting after one.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Context as RequestContext, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	createRegistry,
	type EntryRecord,
	Harness,
	type LiveState,
	type TranscriptView,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { AttachedConversation, connectWhenUp, DaemonError, PierClient } from "../src/host/client.ts";
import { type Daemon, startDaemon } from "../src/host/daemon.ts";
import { createPrompt } from "../src/layer/prompt.ts";

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
		for (const client of clients.splice(0)) client.close();
		await daemon?.close();
		daemon = undefined;
		await rm(dir, { recursive: true, force: true });
	});

	async function start(responses: FauxResponseStep[]): Promise<void> {
		faux.setResponses(responses);
		const models = createModels();
		models.setProvider(faux.provider);
		daemon = await startDaemon({
			socketPath,
			storage: await openNodeSqliteStorage(join(dir, "pier.sqlite")),
			models,
			model: { provider: "faux", modelId: "faux-1" },
			extensions: [createPrompt({ agentDir: join(dir, "agent") })],
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
	const entries = (view: TranscriptView): EntryRecord[] =>
		view.items.flatMap((item) => (item.kind === "entry" ? [item.entry] : []));
	const answered = (text: string) => (view: TranscriptView) =>
		entries(view).some((entry) => JSON.stringify(entry.model ?? []).includes(text));
	const idle = (view: TranscriptView) => (view.docs["pi.live"] as LiveState | undefined)?.run === undefined;

	it("answers a client, and shows the run to another client on the same conversation", async () => {
		await start([fauxAssistantMessage("Hello from faux")]);
		const first = await client();
		const { created } = await first.conversation.attach({ kind: "new" }, dir, {});
		expect(created).toBe(true);
		const id = first.conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		const second = await client();
		await second.conversation.attach({ kind: "id", id }, dir, {});
		const seen = until(second.conversation, answered("Hello from faux"));
		await first.client.request("submit", { text: "hi" });
		await until(first.conversation, answered("Hello from faux"));
		await seen;
	});

	it("runs tools with the environment of the client that attached", async () => {
		await start([
			fauxAssistantMessage(fauxToolCall("bash", { command: "echo marker:$PIER_TEST_VAR" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir, { ...process.env, PIER_TEST_VAR: "from-the-pane" } as Record<
			string,
			string
		>);
		await connected.request("submit", { text: "run it" });
		const view = await until(conversation, answered("done"));
		const result = entries(view).find((entry) => entry.kind === "pi.tool-result");
		expect(JSON.stringify(result?.model)).toContain("marker:from-the-pane");
	});

	it("continues the newest conversation in a directory, and lists by directory", async () => {
		await start([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir, {});
		const first = conversation.id;
		await connected.request("submit", { text: "first conversation" });
		await until(conversation, answered("one"));
		await conversation.attach({ kind: "new" }, join(dir, "elsewhere"), {});
		await connected.request("submit", { text: "second conversation" });
		await until(conversation, answered("two"));

		const { created } = await conversation.attach({ kind: "continue" }, dir, {});
		expect(created).toBe(false);
		expect(conversation.id).toBe(first);
		const { conversations } = await connected.request("list", { cwd: dir });
		expect(conversations.map((summary) => summary.id)).toEqual([first]);
		expect(conversations[0]?.title).toBe("first conversation");
	});

	it("numbers conversations 1, 2, 3, whatever ran in between, and opens them by number", async () => {
		await start([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir, {});
		expect(conversation.number).toBe(1);
		const first = conversation.id;
		// A turn takes a dozen of Durable's ids (entries, tasks, documents) between conversations.
		await connected.request("submit", { text: "one" });
		await until(conversation, answered("first answer"));
		await conversation.attach({ kind: "new" }, dir, {});
		expect(conversation.number).toBe(2);
		await connected.request("submit", { text: "two" });
		await until(conversation, answered("second answer"));
		await conversation.attach({ kind: "new" }, dir, {});
		expect(conversation.number).toBe(3);

		await conversation.attach({ kind: "number", number: 1 }, dir, {});
		expect(conversation.id).toBe(first);
		await until(conversation, answered("first answer"));
		const { conversations } = await connected.request("list", { cwd: dir });
		expect(conversations.map((summary) => summary.number).sort()).toEqual([1, 2, 3]);
		await expect(conversation.attach({ kind: "number", number: 9 }, dir, {})).rejects.toThrow(/No conversation #9/);
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
		await conversation.attach({ kind: "new" }, dir, {});
		await connected.request("submit", { text: "wait" });
		await until(conversation, (view) => !idle(view));
		await connected.request("abort", {});
		const view = await until(conversation, idle);
		expect((view.docs["pi.live"] as LiveState).runFailure?.reason).toBe("aborted");
	});

	it("keeps conversations across a restart", async () => {
		await start([fauxAssistantMessage("remembered")]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir, {});
		const id = conversation.id;
		await connected.request("submit", { text: "remember this" });
		await until(conversation, answered("remembered"));
		await daemon?.close();

		await start([]);
		const again = await client();
		await again.conversation.attach({ kind: "continue" }, dir, {});
		expect(again.conversation.id).toBe(id);
		await until(again.conversation, answered("remembered"));
	});

	it("reattaches after the daemon restarts, getting what it missed without a gap", async () => {
		await start([fauxAssistantMessage("before the restart")]);
		const first = await client();
		await first.conversation.attach({ kind: "new" }, dir, {});
		const id = first.conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		await first.client.request("submit", { text: "one" });
		await until(first.conversation, answered("before the restart"));
		await daemon?.close();
		await first.client.closed;
		// Rejected at once: ws drops a send on a closed socket, so it would otherwise never settle.
		await expect(first.client.request("list", {})).rejects.toThrow(/Not connected/);

		// Retrying from before the new daemon is there.
		const reconnecting = connectWhenUp(socketPath, { firstDelayMs: 10, maxDelayMs: 50 });
		await start([fauxAssistantMessage("while it was away")]);
		const other = await client();
		await other.conversation.attach({ kind: "id", id }, dir, {});
		await other.client.request("submit", { text: "two" });
		await until(other.conversation, answered("while it was away"));

		const next = await reconnecting;
		clients.push(next);
		await first.conversation.reattach(next, dir, {});
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
			await connected.request("submit", { text });
			await until(conversation, answered(answer));
		}
	}
	const answers = (count: number) => Array.from({ length: count }, (_, turn) => fauxAssistantMessage(`answer ${turn}`));

	it("loads earlier entries page by page, until the start", async () => {
		await start(answers(80));
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir, {});
		await converse(connected, conversation, 0, 80);
		const id = conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		const fresh = await client();
		await fresh.conversation.attach({ kind: "id", id }, dir, {});
		let view = await until(fresh.conversation, (latest) => latest.items.length > 0);
		const total = (await connected.request("entries", { limit: 500 })).entries.length;
		expect(total).toBeGreaterThan(150);
		while (view.items[0]?.kind === "earlier") {
			const before = entries(view).length;
			await fresh.conversation.loadEarlier(BACKGROUND_CONTEXT);
			view = await until(fresh.conversation, () => true);
			expect(entries(view).length).toBeGreaterThan(before);
		}
		expect(entries(view).length).toBe(total);
	});

	it("fills the gap a long outage leaves", async () => {
		await start(answers(70));
		const first = await client();
		await first.conversation.attach({ kind: "new" }, dir, {});
		const id = first.conversation.id;
		if (id === undefined) throw new Error("attached without an id");
		await converse(first.client, first.conversation, 0, 2);
		first.client.close();
		await first.client.closed;

		// More than the window holds (100) happens while it's away.
		const other = await client();
		await other.conversation.attach({ kind: "id", id }, dir, {});
		await converse(other.client, other.conversation, 2, 70);

		const next = await client();
		await first.conversation.reattach(next.client, dir, {});
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
		await conversation.attach({ kind: "new" }, dir, {});
		const id = conversation.id;
		await expect(conversation.attach({ kind: "number", number: 9 }, dir, {})).rejects.toThrow(DaemonError);
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
		await mkdir(join(dir, "run"), { recursive: true });
		const server = createServer();
		const sockets = new WebSocketServer({ server });
		sockets.on("connection", (socket) =>
			socket.on("message", (data) => {
				const { id } = JSON.parse(data.toString()) as { id: number };
				socket.send(JSON.stringify({ id, error: { message: "Protocol 2 isn't 3: update pier" } }));
			}),
		);
		await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
		try {
			await expect(connectWhenUp(socketPath, { firstDelayMs: 10 })).rejects.toThrow(/update pier/);
		} finally {
			for (const socket of sockets.clients) socket.terminate();
			await new Promise<void>((resolve) => sockets.close(() => resolve()));
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("refuses a second daemon on the same socket", async () => {
		await start([]);
		const models = createModels();
		await expect(
			startDaemon({
				socketPath,
				storage: await openNodeSqliteStorage(join(dir, "other.sqlite")),
				models,
				model: { provider: "faux", modelId: "faux-1" },
			}),
		).rejects.toThrow(/already listening/);
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
		await conversation.attach({ kind: "new" }, dir, {});
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
			/No model/,
		);
	});

	it("forks before one of your messages, keeping what came before, and lists the fork under its parent", async () => {
		await start([
			fauxAssistantMessage("first answer"),
			fauxAssistantMessage("second answer"),
			fauxAssistantMessage("branch answer"),
		]);
		const { client: connected, conversation } = await client();
		await conversation.attach({ kind: "new" }, dir, {});
		await converse2(connected, conversation, ["one", "first answer"], ["two", "second answer"]);
		const parent = conversation.number;
		const before = (await connected.request("entries", { limit: 50, order: "ascending" })).entries.filter(
			(entry) => entry.kind === "pi.user",
		)[1];
		if (before === undefined || parent === undefined) throw new Error("no second message");
		const { number } = await connected.request("fork", { before: before.id });
		await conversation.attach({ kind: "number", number }, dir, {});
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
		await conversation.attach({ kind: "new" }, dir, {});
		await converse2(connected, conversation, ["one", "first answer"]);
		const first = (await connected.request("entries", { limit: 50 })).entries.find((entry) => entry.kind === "pi.user");
		if (first === undefined) throw new Error("no message");
		const { number } = await connected.request("fork", { before: first.id });
		const parent = (await connected.request("list", {})).conversations.find(
			(summary) => summary.number === number,
		)?.parent;
		expect(parent?.number).toBe(conversation.number);
		await conversation.attach({ kind: "number", number }, dir, {});
		expect((await connected.request("entries", { limit: 50 })).entries).toEqual([]);
		await expect(connected.request("fork", { before: 1 as never })).rejects.toThrow(/your messages/);
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
		await conversation.attach({ kind: "new" }, dir, {});
		await connected.request("submit", { text: "start" });
		await until(conversation, (view) => !idle(view));
		await connected.request("submit", { text: "queued one", whenBusy: "followUp" });
		await connected.request("submit", { text: "queued two", whenBusy: "followUp" });
		expect(await connected.request("dequeue", {})).toEqual({ texts: ["queued one", "queued two"] });
		expect(await connected.request("dequeue", {})).toEqual({ texts: [] });
		release?.();
		const view = await until(conversation, (latest) => idle(latest) && answered("slow answer")(latest));
		expect(answered("queued one")(view)).toBe(false);
	});

	it("rejects requests before attaching", async () => {
		await start([]);
		const { client: connected } = await client();
		await expect(connected.request("submit", { text: "hi" })).rejects.toThrow(/Not attached/);
	});
});
