// Whether Claude Code's recorded environment message, which also names the model, goes
// stale when a conversation's model changes (`/model`), as it does for the directory.
// Two turns: one on Opus, then one on Sonnet, each asking what the environment says.
// todos/environment.evidence.md, "How Claude Code's environment block is made".
//   node experiments/cwd/model.ts
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AssistantEntry, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { CLAUDE_CODE_PROVIDER, ConversationDirectories, loadClaudeCodeProvider } from "../../src/layer/claude-code.ts";
import { createPrompt } from "../../src/layer/prompt.ts";

const context = BACKGROUND_CONTEXT;
const stateDir = mkdtempSync(join(tmpdir(), "pier-cwd-model-"));
const work = join(stateDir, "work");
mkdirSync(work);
process.env.PI_CODING_AGENT_DIR = join(stateDir, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR);

// Experiment only: the bodies pi-claude-code sends upstream, as in run.ts.
let bodies: string[] = [];
const https = createRequire(import.meta.url)("node:https") as typeof import("node:https");
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
syncBuiltinESMExports();

/** The request's model field, and the model sentence in its environment message. */
function sent(body: string | undefined): string {
	if (body === undefined) return "no request";
	const payload = JSON.parse(body) as { model?: string };
	const line = /You are powered by[^\\]*/u.exec(body)?.[0] ?? "no model sentence";
	return `request model ${payload.model}; environment says "${line}"`;
}

const models = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
models.registerNativeProvider(await loadClaudeCodeProvider());
const registry = createRegistry();
registry.install(CodingTools);
registry.install(ConversationDirectories);
registry.install(createPrompt());
const harness = await Harness.open(
	await openNodeSqliteStorage(join(stateDir, "pier.sqlite")),
	{ models, registry, env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? work }) },
	context,
);
const conversation = await harness.root(context, {
	agent: { model: { provider: CLAUDE_CODE_PROVIDER, modelId: "claude-opus-5-5" }, thinkingLevel: "low", cwd: work },
});
const question =
	"Without using tools, in one line: quote verbatim the sentence in your environment information that names the model you are powered by.";

for (const [label, modelId] of [
	["on Opus", "claude-opus-5-5"],
	["after switching to Sonnet", "claude-sonnet-5"],
] as const) {
	// biome-ignore lint/performance/noAwaitInLoops: the turns are in order
	await conversation.configure({ model: { provider: CLAUDE_CODE_PROVIDER, modelId } }, context);
	bodies = [];
	const submission = await conversation.submit({ type: "input", content: question, requestId: label }, context);
	const settled = await submission.wait(context);
	if (settled.status !== "done" || settled.type !== "input") {
		console.log(`${label}: ${settled.status}`);
		continue;
	}
	const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
	const message = entry?.model?.[0];
	if (message?.role !== "assistant") continue;
	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("")
		.trim();
	console.log(`${label}: ${sent(bodies[0])}`);
	console.log(`  answer (${message.model}): ${text}`);
}
await harness.close(context);
