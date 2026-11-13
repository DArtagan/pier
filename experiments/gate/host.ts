// Steps of the gate, in their own process so the driver can kill it, and in one
// process so the provider's in-memory session state carries from step to step.
//   node experiments/gate/host.ts <state-dir> '<steps as a JSON array>'
// Prints JSON lines: each conversation's agent events, and a `result` per step.
import { existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type AssistantMessage, cleanupSessionResources } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	AssistantEntry,
	type Conversation,
	type ConversationId,
	type ConversationView,
	createRegistry,
	type EntryId,
	Harness,
	type LiveState,
	ProviderDoc,
	type SubmissionId,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createPrompt } from "../../src/prompt.ts";
import { CLAUDE_CODE_PROVIDER, loadClaudeCodeProvider } from "../../src/providers/claude-code.ts";

export type Step =
	/** `abortOnTool`: abort the conversation, as Esc does, once a tool call's arguments contain this. */
	| { op: "turn"; conv: string; text: string; requestId: string; abortOnTool?: string }
	/** Processes still running in the workspace, and the host's descendants, after `waitMs`. */
	| { op: "processes"; conv: string; waitMs: number }
	/** Do nothing for `ms`, as a user who leaves a conversation idle. */
	| { op: "idle"; conv: string; ms: number }
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

const model = { provider: CLAUDE_CODE_PROVIDER, modelId: "claude-opus-5-5" };
const models = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
models.registerNativeProvider(await loadClaudeCodeProvider());
out({ t: "provider", models: models.getModels(CLAUDE_CODE_PROVIDER).map((entry) => entry.id) });
const registry = createRegistry();
registry.install(CodingTools);
registry.install(createPrompt());

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
		onReport: (report) => out({ t: "report", kind: report.kind, report, error: String(report.error) }),
	},
	context,
);

let abortTrigger: { conversation: Conversation; match: string } | undefined;

const open = async (key: string): Promise<Conversation> => {
	const id = conversations[key];
	if (key === "root" && id === undefined) {
		const root = await harness.root(context, {
			agent: { model, thinkingLevel: "low", cwd: workspace },
		});
		conversations.root = root.id;
		return root;
	}
	if (id === undefined) throw new Error(`No conversation ${key}`);
	const conversation = await harness.conversation(id, context);
	if (conversation === undefined) throw new Error(`Conversation ${key} (${id}) is gone`);
	return conversation;
};

// Durable 1.5 removed its event stream: clients render the conversation's state. The
// gate still wants a log of what happened, so derive one from the view's changes:
// appended entries, tool slots, the run, and compactions.
const watch = async (conversation: Conversation) => {
	const handle = await conversation.watch(context);
	const seen = new Set<EntryId>(handle.value.entries.map((entry) => entry.id));
	const calls = new Map<string, unknown>();
	const remember = (entries: ConversationView["entries"]) => {
		for (const entry of entries) {
			const message = entry.model?.[0];
			if (message?.role !== "assistant") continue;
			for (const part of message.content) if (part.type === "toolCall") calls.set(part.id, part.arguments);
		}
	};
	remember(handle.value.entries);
	const started = new Set<string>();
	let wasRunning = (handle.value.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
	let compactions = 0;
	const describe = (view: ConversationView) => {
		for (const entry of view.entries) {
			if (seen.has(entry.id)) continue;
			seen.add(entry.id);
			const message = entry.model?.[0];
			if (message?.role === "assistant") {
				remember([entry]);
				out({ t: "assistant", ...summarize(message) });
			} else if (message?.role === "toolResult") {
				out({ t: "tool_end", tool: message.toolName, isError: message.isError, text: textOf(message.content) });
			}
		}
		const live = (view.docs["pi.live"] ?? {}) as LiveState;
		for (const slot of live.tools ?? []) {
			if (slot.status !== "running" || started.has(slot.callId)) continue;
			started.add(slot.callId);
			const args = calls.get(slot.callId) ?? {};
			out({ t: "tool_start", tool: slot.name, args });
			if (abortTrigger?.conversation.id === conversation.id && JSON.stringify(args).includes(abortTrigger.match)) {
				const target = abortTrigger.conversation;
				const match = abortTrigger.match;
				abortTrigger = undefined;
				// Durable shows a slot running before the call's intent is stored and the tool
				// starts, so wait until the command is really running.
				void untilRunning(match).then(() => {
					out({ t: "abort" });
					return target.abort(context);
				});
			}
		}
		const running = live.run !== undefined;
		if (running !== wasRunning) out({ t: running ? "run_start" : "run_end", failure: live.runFailure });
		wasRunning = running;
		const count = live.compactions?.length ?? 0;
		if (count !== compactions) out({ t: count > compactions ? "compaction_start" : "compaction_end" });
		if (count < compactions && live.compactionFailure !== undefined)
			out({ t: "compaction_failure", ...live.compactionFailure });
		compactions = count;
	};
	handle.start(async (call) => {
		if (call.kind === "value") describe(call.value);
	});
	return handle;
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
// Releases per-session provider state, such as the warm Claude Code process pi-claude-code
// keeps for each conversation. pi does this when a session ends; Durable never does, and
// without it that process outlives its 5-minute limit and keeps this one running.
cleanupSessionResources();
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
			return { processes: processesIn(workspace), descendants: descendantsOf(process.pid) };
		}
		case "idle": {
			await new Promise((resolve) => setTimeout(resolve, step.ms));
			return { idled: step.ms };
		}
	}
}

/** Resolves once a process in the workspace has `match` in its command line, or after 10 s. */
async function untilRunning(match: string): Promise<void> {
	for (let waited = 0; waited < 10_000; waited += 50) {
		if (processesIn(workspace).some((line) => line.includes(match))) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/** Live descendants of process `root`, as `pid command line`. Claude Code runs in the host's directory, not the workspace. */
function descendantsOf(root: number): string[] {
	const parents = new Map<number, number>();
	const commands = new Map<number, string>();
	for (const name of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
		try {
			// The parent is the 2nd field after the parenthesized command, which may hold spaces.
			const stat = readFileSync(`/proc/${name}/stat`, "utf8");
			const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
			parents.set(Number(name), parent);
			commands.set(Number(name), readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ").slice(0, 120));
		} catch {
			// Gone, or not ours to read.
		}
	}
	const found: string[] = [];
	for (const [pid, command] of commands) {
		for (let up = parents.get(pid); up !== undefined && up > 1; up = parents.get(up)) {
			if (up === root) {
				found.push(`${pid} ${command}`);
				break;
			}
		}
	}
	return found;
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
		usage: {
			input: message.usage.input,
			cacheRead: message.usage.cacheRead,
			cacheWrite: message.usage.cacheWrite,
			// Of cacheWrite, what was written with a 1-hour lifetime rather than 5 minutes.
			cacheWrite1h: (message.usage as { cacheWrite1h?: number }).cacheWrite1h,
		},
	};
}
