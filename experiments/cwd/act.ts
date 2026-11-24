// Where the model actually works after its conversation's directory changes, with real
// Claude Code, under three ways of handling the change. todos/environment.md, "What /cd
// does to the model". Per trial: a file written in directory alpha, the directory changed
// to bravo, a file written "in the current project directory", then a question.
//   node experiments/cwd/act.ts [trials per variant, default 3] [variant ...]
// Variants: `bare` (configure({ cwd }) alone), `note` (and a note in Claude Code's own
// words for a directory change), `refresh` (and a hook that makes pi-claude-code record
// Claude Code's environment message afresh). Spends about 4 Opus turns per trial, at low
// thinking. PIER_ACT_HISTORY_KB=<n> first has the model read an n-KB file in alpha, so
// the conversation has a long history before the change, to measure what a refresh costs.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	AgentDoc,
	AssistantEntry,
	type Conversation,
	createRegistry,
	defineExtension,
	type Extension,
	GenerationTask,
	Harness,
	hook,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { CLAUDE_CODE_PROVIDER, ConversationDirectories, loadClaudeCodeProvider } from "../../src/layer/claude-code.ts";
import { createPrompt } from "../../src/layer/prompt.ts";

type Variant = "bare" | "note" | "refresh";
const historyKb = Number(process.env.PIER_ACT_HISTORY_KB ?? "0");
const trials = Number(process.argv[2] ?? "3");
const variants = (process.argv.slice(3).length > 0 ? process.argv.slice(3) : ["bare", "note", "refresh"]) as Variant[];
const context = BACKGROUND_CONTEXT;
const stateDir = mkdtempSync(join(tmpdir(), "pier-cwd-act-"));
process.env.PI_CODING_AGENT_DIR = join(stateDir, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR);

// Experiment only: watch what pi-claude-code sends upstream, and which directories it
// starts Claude Code in. Both are patched before the provider loads.
const require = createRequire(import.meta.url);
let bodies: string[] = [];
const https = require("node:https") as typeof import("node:https");
const request = https.request;
https.request = ((...args: Parameters<typeof https.request>) => {
	const made = request(...args);
	if ((args[0] as { path?: string }).path?.includes("/v1/messages")) {
		const end = made.end.bind(made);
		made.end = ((body?: unknown, ...rest: unknown[]) => {
			if (Buffer.isBuffer(body) || typeof body === "string") bodies.push(body.toString());
			return (end as (...a: unknown[]) => typeof made)(body, ...rest);
		}) as typeof made.end;
	}
	return made;
}) as typeof https.request;
const launches: string[] = [];
const childProcess = require("node:child_process") as typeof import("node:child_process");
const spawn = childProcess.spawn;
childProcess.spawn = ((command: string, args: readonly string[], options: { cwd?: string } | undefined) => {
	if (/claude/u.test(command)) launches.push(String(options?.cwd ?? "?"));
	return spawn(command, args, options);
}) as typeof childProcess.spawn;
syncBuiltinESMExports();

/** The directory a request's replayed environment message names, from a stored carrier. */
function recordedDirectory(message: Message): string | undefined {
	if (message.role !== "assistant") return undefined;
	for (const diagnostic of message.diagnostics ?? []) {
		const carrier = (diagnostic.details as { carrier?: { initialSystemMessages?: unknown[] } } | undefined)?.carrier;
		const text = JSON.stringify(carrier?.initialSystemMessages ?? "");
		const match = /Primary working directory: ([^\\]+)\\n/u.exec(text);
		if (match?.[1] !== undefined) return match[1];
	}
	return undefined;
}

/**
 * The `refresh` variant: when the conversation's directory isn't the one pi-claude-code
 * recorded, leave the recorded environment out of this request, so pi-claude-code keeps
 * the one Claude Code just made (in the right directory) and records it again.
 */
const Refresh: Extension = defineExtension({
	name: "experiment.refresh-environment",
	hooks: [
		hook(GenerationTask, {
			beforeRequest: async (requestIn, api, hookContext) => {
				const cwd = (await api.snapshot(AgentDoc, api.conversationId, hookContext))?.cwd;
				const latest = [...requestIn.messages]
					.reverse()
					.map(recordedDirectory)
					.find((dir) => dir !== undefined);
				if (cwd === undefined || latest === undefined || latest === cwd) return;
				const messages = requestIn.messages.map((message) => {
					if (message.role !== "assistant" || message.diagnostics === undefined) return message;
					const diagnostics = message.diagnostics.map((diagnostic) => {
						const details = diagnostic.details as { carrier?: Record<string, unknown> } | undefined;
						if (details?.carrier?.initialSystemMessages === undefined) return diagnostic;
						const { initialSystemMessages: _dropped, ...carrier } = details.carrier;
						return { ...diagnostic, details: { ...details, carrier } };
					});
					return { ...message, diagnostics } as AssistantMessage;
				});
				return { messages };
			},
		}),
	],
});

const model = { provider: CLAUDE_CODE_PROVIDER, modelId: "claude-opus-5-5" };
const models = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
models.registerNativeProvider(await loadClaudeCodeProvider());

interface Turn {
	text: string;
	cached: string;
	/** Tokens of the turn's first request: read from the cache, and written to it. */
	first: string;
	writes: string[];
	envLine: string;
}

async function turn(conversation: Conversation, content: string, requestId: string, root: string): Promise<Turn> {
	bodies = [];
	const before = (await conversation.entries({}, 1, undefined, context)).items[0]?.id ?? 0;
	const submission = await conversation.submit({ type: "input", content, requestId }, context);
	const settled = await submission.wait(context);
	let answer: AssistantMessage | undefined;
	if (settled.status === "done" && settled.type === "input") {
		const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
		if (entry?.model?.[0]?.role === "assistant") answer = entry.model[0];
	}
	// This turn's write tool calls, by the path the model gave, and its first response's usage.
	const writes: string[] = [];
	let firstUsage: AssistantMessage["usage"] | undefined;
	const page = await conversation.entries({}, 60, undefined, context);
	for (const entry of [...page.items].sort((a, b) => a.id - b.id)) {
		if (entry.id <= before) continue;
		const message = entry.model?.[0];
		if (message?.role !== "assistant") continue;
		firstUsage ??= message.usage;
		for (const part of message.content) {
			if (part.type === "toolCall" && part.name === "write") writes.push(String(part.arguments.path));
		}
	}
	const usage = answer?.usage;
	const total = usage === undefined ? 0 : usage.input + usage.cacheRead + usage.cacheWrite;
	const envMatch = /Primary working directory: ([^\\]+)\\n/u.exec(bodies[0] ?? "");
	return {
		text: (answer?.content ?? [])
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("")
			.trim()
			.replaceAll(root, "<t>")
			.replaceAll("\n", " | ")
			.slice(0, 240),
		cached: usage === undefined || total === 0 ? "?" : `${((100 * usage.cacheRead) / total).toFixed(0)}%`,
		first:
			firstUsage === undefined
				? "?"
				: `read ${firstUsage.cacheRead}, wrote ${firstUsage.cacheWrite}, input ${firstUsage.input}`,
		writes: [...new Set(writes)].map((path) => path.replaceAll(root, "<t>")),
		envLine: (envMatch?.[1] ?? "none").replaceAll(root, "<t>"),
	};
}

const summary: string[] = [];
for (const variant of variants) {
	const dir = join(stateDir, variant);
	mkdirSync(dir);
	const registry = createRegistry();
	registry.install(CodingTools);
	registry.install(ConversationDirectories);
	registry.install(createPrompt());
	if (variant === "refresh") registry.install(Refresh);
	// biome-ignore lint/performance/noAwaitInLoops: one variant at a time
	const harness = await Harness.open(
		await openNodeSqliteStorage(join(dir, "pier.sqlite")),
		{
			models,
			registry,
			env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? dir }),
			settings: { toolExecution: "sequential" },
		},
		context,
	);
	for (let trial = 1; trial <= trials; trial++) {
		const root = join(dir, `trial-${trial}`);
		const alpha = join(root, "alpha-project");
		const bravo = join(root, "bravo-project");
		mkdirSync(alpha, { recursive: true });
		mkdirSync(bravo, { recursive: true });
		writeFileSync(join(alpha, "README.md"), "# Alpha\n");
		writeFileSync(join(bravo, "README.md"), "# Bravo\n");
		if (historyKb > 0) {
			const line = "The quick brown fox jumps over the lazy dog, again and again, for the record.\n";
			writeFileSync(join(alpha, "notes.txt"), line.repeat(Math.ceil((historyKb * 1024) / line.length)));
		}
		launches.length = 0;
		// biome-ignore lint/performance/noAwaitInLoops: one trial at a time, so each one's launches are its own
		const conversation = await harness.createConversation(
			{ ownership: { kind: "ownerless" }, agent: { model, thinkingLevel: "low", cwd: alpha } },
			context,
		);
		const id = `${variant}-${trial}`;
		const one = await turn(
			conversation,
			(historyKb > 0 ? "Read notes.txt in full with the read tool, then create" : "Create") +
				" a file named marker.txt containing the word first, in the current project directory.",
			`${id}-1`,
			root,
		);
		await conversation.configure({ cwd: bravo }, context);
		if (variant === "note") {
			// Claude Code's own words for a change of directory mid-session (2.1.329's
			// "# Environment update" message), here as the conversation's instructions.
			await conversation.configure(
				{ instructions: `# Environment update\nPrimary working directory: ${bravo} (was ${alpha})` },
				context,
			);
		}
		const two = await turn(
			conversation,
			"Create a file named marker.txt containing the word second, in the current project directory. Then tell me its absolute path.",
			`${id}-2`,
			root,
		);
		const three = await turn(
			conversation,
			"Without using tools: what is your primary working directory now? One line.",
			`${id}-3`,
			root,
		);
		const landed = existsSync(join(bravo, "marker.txt"))
			? readFileSync(join(bravo, "marker.txt"), "utf8").trim()
			: "(none)";
		const strayed = readFileSync(join(alpha, "marker.txt"), "utf8").trim();
		const ok = landed.includes("second") && !strayed.includes("second");
		console.log(`\n== ${id}: ${ok ? "RIGHT" : "WRONG"} directory after the change`);
		console.log(`  turn 1 (alpha): ${one.cached} cached; writes ${one.writes.join(", ")}; env line ${one.envLine}`);
		console.log(
			`  turn 2 (after the change): ${two.cached} cached; first request ${two.first}; env line ${two.envLine}; writes ${two.writes.join(", ")}`,
		);
		console.log(`  turn 2 answer: ${two.text}`);
		console.log(`  turn 3: ${three.cached} cached; env line ${three.envLine}; answer: ${three.text}`);
		console.log(`  bravo/marker.txt: ${landed}; alpha/marker.txt: ${strayed}`);
		console.log(`  Claude Code started in: ${launches.map((cwd) => cwd.replaceAll(root, "<t>")).join(", ")}`);
		summary.push(
			`${id}: ${ok ? "RIGHT" : "WRONG"}; turn 2 ${two.cached} cached (first request ${two.first}); turn 3 ${three.cached}; env line after: ${three.envLine}`,
		);
	}
	await harness.close(context);
}
console.log(`\n== summary\n${summary.join("\n")}\nstate left in ${stateDir}`);
