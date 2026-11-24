// What a conversation's change of directory (`/cd`, `configure({ cwd })`) does with real
// Claude Code: which directory each part of the request names afterwards, and what it
// costs the prompt cache. Four Opus turns, at low thinking: two in directory A, then the
// change, then two in B. todos/environment.md, "Why changing directory costs the prompt
// cache".
//   node experiments/cwd/run.ts
// Leaves its state directory behind, with each turn's request bodies (no headers), and
// prints its path.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AssistantEntry, type Conversation, createRegistry, Harness } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { CLAUDE_CODE_PROVIDER, ConversationDirectories, loadClaudeCodeProvider } from "../../src/layer/claude-code.ts";
import { createPrompt } from "../../src/layer/prompt.ts";

const context = BACKGROUND_CONTEXT;
const stateDir = mkdtempSync(join(tmpdir(), "pier-cwd-"));
const dirA = join(stateDir, "alpha-directory");
const dirB = join(stateDir, "bravo-directory");
const agentDir = join(stateDir, "agent");
for (const dir of [dirA, dirB, agentDir]) mkdirSync(dir);
// pi's agent dir for this run alone, as the gate does.
process.env.PI_CODING_AGENT_DIR = agentDir;

// pi-claude-code relays Claude Code's requests through this process with node:https, so
// the bodies it sends upstream can be caught here. Experiment only.
interface Captured {
	body: string;
}
let captured: Captured[] = [];
const https = createRequire(import.meta.url)("node:https") as typeof import("node:https");
const original = https.request;
https.request = ((...args: Parameters<typeof https.request>) => {
	const request = original(...args);
	const options = args[0] as { path?: string };
	if (typeof options === "object" && options.path?.includes("/v1/messages")) {
		const end = request.end.bind(request);
		request.end = ((body?: unknown, ...rest: unknown[]) => {
			if (Buffer.isBuffer(body) || typeof body === "string") captured.push({ body: body.toString() });
			return (end as (...a: unknown[]) => typeof request)(body, ...rest);
		}) as typeof request.end;
	}
	return request;
}) as typeof https.request;
syncBuiltinESMExports();

const model = { provider: CLAUDE_CODE_PROVIDER, modelId: "claude-opus-5-5" };
const models = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
models.registerNativeProvider(await loadClaudeCodeProvider());
const registry = createRegistry();
registry.install(CodingTools);
registry.install(ConversationDirectories);
registry.install(createPrompt());
const harness = await Harness.open(
	await openNodeSqliteStorage(join(stateDir, "pier.sqlite")),
	{
		models,
		registry,
		env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? dirA }),
		settings: { toolExecution: "sequential" },
	},
	context,
);
const conversation = await harness.root(context, { agent: { model, thinkingLevel: "low", cwd: dirA } });

const QUESTION =
	"Without using any tools, answer in exactly two lines. Line 1: the working directory your " +
	"environment information states, verbatim. Line 2: the directory inside the <cwd> section " +
	"of your system prompt, verbatim, or NONE if there is no such section.";

/** Where each directory's path appears in a request body: the system field, or a message by index and role. */
function locate(body: string): { alpha: string[]; bravo: string[] } {
	const found = { alpha: [] as string[], bravo: [] as string[] };
	let payload: { system?: unknown; messages?: { role: string; content: unknown }[] };
	try {
		payload = JSON.parse(body);
	} catch {
		return found;
	}
	const places: [string, unknown][] = [["system", payload.system]];
	for (const [index, message] of (payload.messages ?? []).entries()) {
		places.push([`messages[${index}] ${message.role}`, message.content]);
	}
	for (const [place, value] of places) {
		const text = JSON.stringify(value ?? "");
		if (text.includes(dirA)) found.alpha.push(place);
		if (text.includes(dirB)) found.bravo.push(place);
	}
	return found;
}

/** Up to 60 characters either side of each mention of `dir`, for reading what names it. */
function mentions(body: string, dir: string): string[] {
	const out: string[] = [];
	for (let at = body.indexOf(dir); at >= 0 && out.length < 4; at = body.indexOf(dir, at + 1)) {
		out.push(body.slice(Math.max(0, at - 60), at + dir.length + 20).replaceAll("\\n", " "));
	}
	return out;
}

async function turn(label: string, requestId: string): Promise<void> {
	captured = [];
	const submission = await conversation.submit({ type: "input", content: QUESTION, requestId }, context);
	const settled = await submission.wait(context);
	let message: AssistantMessage | undefined;
	if (settled.status === "done" && settled.type === "input") {
		const entry = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
		const first = entry?.model?.[0];
		if (first?.role === "assistant") message = first;
	}
	const usage = message?.usage;
	const total = usage === undefined ? 0 : usage.input + usage.cacheRead + usage.cacheWrite;
	const share = usage === undefined || total === 0 ? "?" : `${((100 * usage.cacheRead) / total).toFixed(1)}% cached`;
	console.log(`\n== ${label}`);
	console.log(`status: ${settled.status}${message?.errorMessage ? ` (${message.errorMessage})` : ""}`);
	console.log(
		usage === undefined
			? "usage: none"
			: `usage: ${share}; input ${usage.input}, cache read ${usage.cacheRead}, cache write ${usage.cacheWrite}`,
	);
	const text = message?.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("")
		.trim();
	console.log(`answer: ${text?.replaceAll(stateDir, "<state>").replaceAll("\n", " | ")}`);
	console.log(`upstream requests: ${captured.length}`);
	const last = captured.at(-1);
	if (last !== undefined) {
		const where = locate(last.body);
		console.log(`alpha named in: ${where.alpha.join(", ") || "nowhere"}`);
		console.log(`bravo named in: ${where.bravo.join(", ") || "nowhere"}`);
		for (const [name, dir] of [
			["alpha", dirA],
			["bravo", dirB],
		] as const) {
			for (const mention of mentions(last.body, dir)) {
				console.log(`  ${name}: …${mention.replaceAll(stateDir, "<state>")}…`);
			}
		}
	}
	for (const [index, request] of captured.entries()) {
		writeFileSync(join(stateDir, `${requestId}-${index}.json`), request.body);
	}
}

async function changeDirectory(to: string, conv: Conversation): Promise<void> {
	await conv.configure({ cwd: to }, context);
	console.log(`\n-- configure({ cwd: ${to.replaceAll(stateDir, "<state>")} })`);
}

console.log(`state: ${stateDir}`);
await turn("1. in alpha, first turn (cold)", "cwd-1");
await turn("2. in alpha, again (warm)", "cwd-2");
await changeDirectory(dirB, conversation);
await turn("3. in bravo, first turn after the change", "cwd-3");
await turn("4. in bravo, again", "cwd-4");
await harness.close(context);
console.log(`\nstate left in ${stateDir}`);
