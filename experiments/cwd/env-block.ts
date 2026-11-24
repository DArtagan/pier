// What Claude Code itself puts in the environment block of its first request, under
// different directories, flags and variables, without reaching Anthropic: Claude Code's
// API base points at a stub on loopback that keeps the request's body (never its
// headers, which carry the login) and answers 400, so Claude Code stops. No tokens are
// spent. todos/environment.md, "How Claude Code's environment block is made".
//   node experiments/cwd/env-block.ts
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pier-env-block-"));
const plain = join(root, "plain-directory");
const repo = join(root, "git-repository");
const worktree = join(root, "a-worktree");
mkdirSync(plain);
mkdirSync(repo);
execFileSync("git", ["init", "-q", repo]);
execFileSync("git", [
	"-C",
	repo,
	"-c",
	"user.email=x@y",
	"-c",
	"user.name=x",
	"commit",
	"-q",
	"--allow-empty",
	"-m",
	"x",
]);
execFileSync("git", ["-C", repo, "worktree", "add", "-q", worktree]);
const systemPath = join(root, "system.txt");
writeFileSync(systemPath, "You are a coding agent.");

let bodies: string[] = [];
const server = createServer((request, response) => {
	const chunks: Buffer[] = [];
	request.on("data", (chunk: Buffer) => chunks.push(chunk));
	request.on("end", () => {
		if (request.url?.includes("/v1/messages")) bodies.push(Buffer.concat(chunks).toString());
		const error = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stub" } });
		response.writeHead(400, { "content-type": "application/json" }).end(error);
	});
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/** The request's system messages and system field, as Claude Code sent them: its own words only. */
async function firstRequest(cwd: string, flags: string[] = [], env: Record<string, string> = {}): Promise<string> {
	bodies = [];
	const command = process.env.PI_CLAUDE_CODE_COMMAND ?? "claude";
	const args = [
		"-p",
		"--model",
		"claude-opus-5-5",
		"--tools",
		"",
		"--system-prompt-file",
		systemPath,
		"--setting-sources",
		"",
		"--strict-mcp-config",
		"--max-turns",
		"1",
		"--no-session-persistence",
		...flags,
		"Say hi.",
	];
	await new Promise<void>((resolve) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ANTHROPIC_BASE_URL: base, ...env },
			stdio: ["ignore", "ignore", "ignore"],
		});
		const timer = setTimeout(() => child.kill(), 60_000);
		child.on("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
	const body = bodies[0];
	if (body === undefined) return "(no request)";
	const payload = JSON.parse(body) as { system?: unknown; messages: { role: string; content: unknown }[] };
	const text = (value: unknown): string =>
		typeof value === "string"
			? value
			: Array.isArray(value)
				? value.map((block) => (block as { text?: string }).text ?? "").join("\n")
				: "";
	const parts = [`system field: ${text(payload.system).replaceAll("\n", " ").slice(0, 200)}`];
	for (const [index, message] of payload.messages.entries()) {
		parts.push(`messages[${index}] ${message.role}:\n${text(message.content)}`);
	}
	return parts.join("\n").replaceAll(root, "<root>");
}

const cases: [string, string, string[], Record<string, string>][] = [
	["a plain directory", plain, [], {}],
	["a git repository", repo, [], {}],
	["a git worktree", worktree, [], {}],
	["--exclude-dynamic-system-prompt-sections", repo, ["--exclude-dynamic-system-prompt-sections"], {}],
	["CLAUDE_CODE_HIDE_CWD=1", repo, [], { CLAUDE_CODE_HIDE_CWD: "1" }],
	["CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1", repo, [], { CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: "1" }],
];
for (const [label, cwd, flags, env] of cases) {
	// biome-ignore lint/performance/noAwaitInLoops: one Claude Code at a time, against one stub
	console.log(`\n===== ${label}\n${await firstRequest(cwd, flags, env)}`);
}
server.close();
console.log(`\nleft in ${root}`);
