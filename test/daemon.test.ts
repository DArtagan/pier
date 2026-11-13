// The daemon and its clients, over a real Unix socket, with a faux model in place of
// Claude: attach, submit, watch, several clients, the client's environment, abort, and
// a restart.
import { mkdtemp, rm } from "node:fs/promises";
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
import { AttachedConversation, PierClient } from "../src/client.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { createPrompt } from "../src/prompt.ts";

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

	it("rejects requests before attaching", async () => {
		await start([]);
		const { client: connected } = await client();
		await expect(connected.request("submit", { text: "hi" })).rejects.toThrow(/Not attached/);
	});
});
