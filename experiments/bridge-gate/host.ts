// Steps of the bridge gate, in their own process so the driver can kill it, and in one
// process so the bridge's in-memory session state carries from step to step.
//   node experiments/bridge-gate/host.ts <state-dir> '<steps as a JSON array>'
// Prints JSON lines: each conversation's agent events, and a `result` per step.
// PIER_GATE_NO_REWRITE_MARK=1 turns off the shim's history-rewrite mark, as a control.
import { existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	AssistantEntry,
	type Conversation,
	type ConversationId,
	createRegistry,
	Harness,
	ProviderDoc,
	type SubmissionId,
	watchEvents,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { loadBridge } from "../../src/bridge/load.ts";
import { createBridgeShim } from "../../src/bridge/shim.ts";
import { createPrompt } from "../../src/prompt.ts";

export type Step =
	/** `abortOnTool`: abort the conversation, as Esc does, once a tool call's arguments contain this. */
	| { op: "turn"; conv: string; text: string; requestId: string; abortOnTool?: string }
	/** Processes still running in the workspace after `waitMs`. */
	| { op: "processes"; conv: string; waitMs: number }
	| { op: "resume"; conv: string; submission: SubmissionId }
	| { op: "compact"; conv: string; instructions?: string }
	| { op: "fork"; conv: string; as: string }
	| { op: "inspect"; conv: string };

const [stateDir, stepsJson] = process.argv.slice(2);
if (stateDir === undefined || stepsJson === undefined) throw new Error("usage: host.ts <state-dir> <steps-json>");
const steps = JSON.parse(stepsJson) as Step[];
const workspace = join(stateDir, "workspace");
const statePath = join(stateDir, "conversations.json");
const conversations: Record<string, ConversationId> = existsSync(statePath)
	? JSON.parse(readFileSync(statePath, "utf8"))
	: {};
const context = BACKGROUND_CONTEXT;
const out = (line: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(line)}\n`);

const models = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
const prompt = createPrompt();
const bridge = await loadBridge();
const shim = createBridgeShim(bridge, {
	models,
	promptOptions: ({ cwd }) => prompt.options(cwd),
	notify: (message, type) => out({ t: "notify", type, message }),
	log: (message) => out({ t: "shim", message }),
	markRewrites: process.env.PIER_GATE_NO_REWRITE_MARK !== "1",
});
out({ t: "bridge", root: bridge.root, events: shim.events, droppedTools: shim.droppedTools });

const registry = createRegistry();
registry.install(CodingTools);
registry.install(prompt.extension);
registry.install(shim.extension);

const harness = await Harness.open(
	await openNodeSqliteStorage(join(stateDir, "pier.sqlite")),
	{
		models,
		registry,
		env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? workspace }),
		settings: {
			toolExecution: "sequential",
			// Small enough that a few turns give compaction something to summarize.
			compaction: { keepRecentTokens: 200 },
		},
		onReport: (error, info) => out({ t: "report", info, error: String(error) }),
	},
	context,
);
// PIER_GATE_NO_RUN_END=1 leaves the shim unattached, so runs ending go unseen, as a control.
if (process.env.PIER_GATE_NO_RUN_END !== "1") shim.attach(harness);

let abortTrigger: { conversation: Conversation; match: string } | undefined;

const open = async (key: string): Promise<Conversation> => {
	const id = conversations[key];
	if (key === "root" && id === undefined) {
		const root = await harness.root(context, {
			agent: { model: { provider: "claude-bridge", modelId: "claude-opus-5-5" }, thinkingLevel: "low", cwd: workspace },
		});
		conversations.root = root.id;
		return root;
	}
	if (id === undefined) throw new Error(`No conversation ${key}`);
	const conversation = await harness.conversation(id, context);
	if (conversation === undefined) throw new Error(`Conversation ${key} (${id}) is gone`);
	return conversation;
};

const watch = async (conversation: Conversation) => {
	const stream = await watchEvents(harness, conversation.id, context);
	stream.start(async (events) => {
		for (const event of events) {
			switch (event.type) {
				case "tool_execution_start":
					out({ t: "tool_start", tool: event.toolName, args: event.args });
					if (
						abortTrigger?.conversation.id === conversation.id &&
						JSON.stringify(event.args).includes(abortTrigger.match)
					) {
						const target = abortTrigger.conversation;
						abortTrigger = undefined;
						out({ t: "abort" });
						void target.abort(context);
					}
					break;
				case "tool_execution_end": {
					const result = event.entry?.model?.[0];
					const text = result?.role === "toolResult" ? textOf(result.content) : undefined;
					out({ t: "tool_end", tool: event.toolName, isError: result?.role === "toolResult" && result.isError, text });
					break;
				}
				case "message_end": {
					const message = event.entry.model?.[0];
					if (message?.role === "assistant") out({ t: "assistant", ...summarize(message) });
					break;
				}
				case "compaction_start":
				case "compaction_end":
				case "task_failed":
				case "auto_retry_start":
				case "run_start":
				case "run_end":
					out({ t: event.type, ...event, type: undefined });
					break;
			}
		}
	});
	return stream;
};

const settle = async (conversation: Conversation, id: SubmissionId) => {
	const submission = await harness.submission(id, context);
	if (submission === undefined) throw new Error(`No submission ${id}`);
	const settled = await submission.wait(context);
	let answer: ReturnType<typeof summarize> | undefined;
	if (settled.status === "done" && settled.type === "input") {
		const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
		const message = entry?.model?.[0];
		if (message?.role === "assistant") answer = summarize(message);
	}
	return { status: settled.status, reason: "reason" in settled ? settled.reason : undefined, answer };
};

const watched = new Map<ConversationId, Awaited<ReturnType<typeof watch>>>();
for (const step of steps) {
	const conversation = await open(step.conv);
	if (!watched.has(conversation.id)) {
		const provider = await harness.snapshot(ProviderDoc, conversation.id, context);
		out({ t: "conversation", key: step.conv, id: conversation.id, providerSessionId: provider?.sessionId });
		watched.set(conversation.id, await watch(conversation));
	}
	out({ t: "result", step, ...(await run(step, conversation)) });
	writeFileSync(statePath, JSON.stringify(conversations, null, "\t"));
}
for (const stream of watched.values()) await stream.stop();
await shim.shutdown();
await harness.close(context);

async function run(step: Step, conversation: Conversation): Promise<Record<string, unknown>> {
	switch (step.op) {
		case "turn": {
			if (step.abortOnTool !== undefined) abortTrigger = { conversation, match: step.abortOnTool };
			const submission = await conversation.submit(
				{ type: "input", content: step.text, requestId: step.requestId },
				context,
			);
			out({ t: "submitted", id: submission.id });
			return settle(conversation, submission.id);
		}
		case "resume": {
			harness.resume();
			return settle(conversation, step.submission);
		}
		case "compact": {
			const taskId = await conversation.compact(step.instructions, context);
			const { state } = await harness.waitForTask(taskId, context);
			return { outcome: state.status === "terminal" ? state.outcome : state.status };
		}
		case "fork": {
			const page = await conversation.entries({}, 1, undefined, context);
			const last = page.items[0];
			if (last === undefined) throw new Error(`${step.conv} has no entries`);
			const fork = await conversation.fork(last.id, { ownership: { kind: "ownerless" } }, context);
			conversations[step.as] = fork.id;
			const forkProvider = await harness.snapshot(ProviderDoc, fork.id, context);
			return { fork: fork.id, at: last.id, providerSessionId: forkProvider?.sessionId };
		}
		case "inspect":
			return { inspect: await harness.inspect(context) };
		case "processes": {
			await new Promise((resolve) => setTimeout(resolve, step.waitMs));
			return { processes: processesIn(workspace) };
		}
	}
}

/** Live processes whose working directory is under `dir`. */
export function processesIn(dir: string): string[] {
	const found: string[] = [];
	for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
		try {
			if (!readlinkSync(`/proc/${pid}/cwd`).startsWith(dir)) continue;
			found.push(`${pid} ${readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").slice(0, 120)}`);
		} catch {
			// Gone, or not ours to read.
		}
	}
	return found;
}

function textOf(content: readonly { type: string; text?: string }[] | string): string {
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`)).join("");
}

function summarize(message: AssistantMessage) {
	return {
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		text: textOf(message.content.filter((part) => part.type === "text")),
		toolCalls: message.content.filter((part) => part.type === "toolCall").map((part) => part.name),
	};
}
