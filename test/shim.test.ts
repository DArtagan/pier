// The shim against a stand-in for pi-claude-bridge, on a real Harness and ModelRuntime.
// The gate (experiments/bridge-gate) runs the real bridge; these run offline.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	type SimpleStreamOptions,
	Type,
} from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	type Conversation,
	createRegistry,
	defineExtension,
	defineTool,
	Harness,
	MemoryStorage,
	ProviderDoc,
	section,
} from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LoadedBridge, loadBridge } from "../src/bridge/load.ts";
import { type BridgeShim, createBridgeShim } from "../src/bridge/shim.ts";

const context = BACKGROUND_CONTEXT;

type Respond = (call: Call) => AssistantMessage | "hang";
interface Call {
	context: Context;
	options: SimpleStreamOptions | undefined;
}

/** Records what the bridge would see, and answers from a script. */
function fakeBridge(toBridgeContext: LoadedBridge["toBridgeContext"], respond: Respond) {
	const events: { type: string; event: Record<string, unknown>; ctx: Record<string, unknown> }[] = [];
	const calls: Call[] = [];
	const factory = (pi: {
		on(event: string, handler: (event: Record<string, unknown>, ctx: unknown) => void): void;
		registerProvider(id: string, config: unknown): void;
		registerTool(tool: { name: string }): void;
	}) => {
		for (const type of ["session_start", "before_agent_start", "session_compact", "session_shutdown"]) {
			pi.on(type, (event, ctx) => events.push({ type, event, ctx: ctx as Record<string, unknown> }));
		}
		pi.registerTool({ name: "AskClaude" });
		pi.registerProvider("fake-bridge", {
			baseUrl: "fake-bridge",
			apiKey: "not-used",
			api: "fake-bridge",
			models: [
				{
					id: "fake",
					name: "fake",
					reasoning: false,
					input: ["text"],
					contextWindow: 200_000,
					maxTokens: 8_000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
			streamSimple: (_model: unknown, transcript: Context, options?: SimpleStreamOptions) => {
				const call = { context: transcript, options };
				calls.push(call);
				const stream = createAssistantMessageEventStream();
				const answer = respond(call);
				if (answer === "hang") {
					options?.signal?.addEventListener("abort", () => {
						const aborted = fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "aborted" });
						stream.push({ type: "error", reason: "aborted", error: aborted });
						stream.end();
					});
				} else {
					queueMicrotask(() => {
						stream.push({ type: "start", partial: answer });
						stream.push({
							type: "done",
							reason: answer.stopReason === "toolUse" ? "toolUse" : "stop",
							message: answer,
						});
						stream.end();
					});
				}
				return stream;
			},
		});
	};
	// The real bridge takes pi's whole ExtensionAPI; this one only what the shim provides.
	const bridge: LoadedBridge = { factory: factory as LoadedBridge["factory"], toBridgeContext, root: "fake" };
	return { bridge, events, calls };
}

const noop = defineTool({
	name: "noop",
	description: "Does nothing",
	parameters: Type.Object({}),
	execute: async () => ({ output: [{ type: "text", text: "ok" }] }),
});

describe("bridge shim", () => {
	let dir: string;
	let toBridgeContext: LoadedBridge["toBridgeContext"];
	let harness: Harness | undefined;
	let shim: BridgeShim | undefined;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "pier-shim-"));
		({ toBridgeContext } = await loadBridge());
	});
	afterEach(async () => {
		await shim?.shutdown();
		await harness?.close(context);
		harness = undefined;
		shim = undefined;
		await rm(dir, { recursive: true, force: true });
	});

	async function open(respond: Respond): Promise<ReturnType<typeof fakeBridge> & { root: Conversation }> {
		const fake = fakeBridge(toBridgeContext, respond);
		const models = await ModelRuntime.create({
			authPath: join(dir, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		shim = createBridgeShim(fake.bridge, {
			models,
			promptOptions: ({ cwd }) => ({ contextFiles: [{ path: join(cwd, "AGENTS.md"), content: "Be brief." }] }),
		});
		const registry = createRegistry();
		registry.install(
			defineExtension({ name: "tools", tools: [noop], sections: [section("cwd", (input) => input.agent.cwd)] }),
		);
		registry.install(shim.extension);
		// Small enough that three short turns leave something to compact.
		const settings = { compaction: { keepRecentTokens: 1 } };
		harness = await Harness.open(new MemoryStorage(), { models, registry, settings }, context);
		const root = await harness.root(context, {
			agent: { model: { provider: "fake-bridge", modelId: "fake" }, cwd: dir },
		});
		return { ...fake, root };
	}

	const ask = async (root: Conversation, text: string) => {
		const submission = await root.submit({ type: "input", content: text }, context);
		return submission.wait(context);
	};

	it("drops AskClaude and forwards the provider", async () => {
		const { root } = await open(() => fauxAssistantMessage("hi"));
		expect(shim?.droppedTools).toEqual(["AskClaude"]);
		expect((await ask(root, "hello")).status).toBe("done");
	});

	it("announces each conversation once, as a startup, with its directory and provider session", async () => {
		const { root, events } = await open(() => fauxAssistantMessage("hi"));
		await ask(root, "one");
		await ask(root, "two");
		const starts = events.filter((event) => event.type === "session_start");
		expect(starts).toHaveLength(1);
		expect(starts[0]?.event.reason).toBe("startup");
		const ctx = starts[0]?.ctx as { cwd: string; sessionManager: { getSessionId(): string } };
		expect(ctx.cwd).toBe(dir);
		const provider = await harness?.snapshot(ProviderDoc, root.id, context);
		expect(ctx.sessionManager.getSessionId()).toBe(provider?.sessionId);
	});

	it("records each prompt under the key the bridge will look it up by", async () => {
		const { root, events, calls } = await open(() => fauxAssistantMessage("hi"));
		await ask(root, "hello");
		const recorded = events.filter((event) => event.type === "before_agent_start");
		expect(recorded).toHaveLength(1);
		const key = toBridgeContext(calls[0]?.context as Context).systemPrompt;
		expect(key).toContain(dir);
		expect(recorded[0]?.event.systemPrompt).toBe(key);
		expect(recorded[0]?.event.systemPromptOptions).toEqual({
			contextFiles: [{ path: join(dir, "AGENTS.md"), content: "Be brief." }],
		});
	});

	it("keeps the bridge's signal alive across a tool round", async () => {
		const { root, calls } = await open((call) =>
			call.context.messages.at(-1)?.role === "toolResult"
				? fauxAssistantMessage("done")
				: fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" }),
		);
		expect((await ask(root, "use the tool")).status).toBe("done");
		expect(calls).toHaveLength(2);
		const [first, second] = calls.map((call) => call.options?.signal);
		// The same signal a parked Claude Code query listens on, unaborted after the
		// request that created it ended its task invocation.
		expect(second).toBe(first);
		expect(first?.aborted).toBe(false);
	});

	it("forwards a real abort to the bridge", async () => {
		const { root, calls } = await open(() => "hang");
		await root.submit({ type: "input", content: "wait forever" }, context);
		await expect.poll(() => calls.length).toBe(1);
		await root.abort(context);
		expect(calls[0]?.options?.signal?.aborted).toBe(true);
	});

	it("tells the bridge when history is rewritten, and only then", async () => {
		const { root, events } = await open(() => fauxAssistantMessage("hi"));
		await ask(root, "one");
		await ask(root, "two");
		expect(events.filter((event) => event.type === "session_compact")).toHaveLength(0);
		await root.reset("We said hi twice.", context);
		await ask(root, "three");
		expect(events.filter((event) => event.type === "session_compact")).toHaveLength(1);
	});

	it("passes summaries through untouched", async () => {
		const { root, calls } = await open(() => fauxAssistantMessage("summary"));
		await ask(root, "one");
		await ask(root, "two");
		await ask(root, "three");
		const id = await root.compact(undefined, context);
		await harness?.waitForTask(id, context);
		const summary = calls.find((call) => call.options?.cacheRetention === "none");
		// Durable sends compaction with the conversation's session id; the bridge routes on
		// cacheRetention, to a Claude Code process that lives for this one request.
		expect(summary?.options?.sessionId).toBe(calls[0]?.options?.sessionId);
		expect(summary?.options?.signal).not.toBe(calls[0]?.options?.signal);
	});
});
