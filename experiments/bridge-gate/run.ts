// The bridge gate (step 1 in todos/): pi-claude-bridge on a Durable Harness, through
// the shim, against the real Claude Code. Each group of steps runs host.ts in its own
// process; steps in one group share the bridge's in-memory session state.
//   npm run gate            (uses your Claude Code login: about fifteen Opus turns)
// Leaves its state directory behind and prints its path, with the bridge's debug log.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Step } from "./host.ts";

type Line = Record<string, unknown> & { t: string };

const MARKER = "PINEAPPLE";
const stateDir = mkdtempSync(join(tmpdir(), "pier-gate-"));
const workspace = join(stateDir, "workspace");
const bridgeLog = join(stateDir, "bridge.log");
mkdirSync(workspace);
// The model never reads this file in the gate, so the marker in its answers can only
// have come from the context files the bridge forwards to Claude Code.
writeFileSync(
	join(workspace, "AGENTS.md"),
	`# Instructions\n\nEnd every final answer with the word ${MARKER} on its own line.\n`,
);

const checks: { group: string; check: string; ok: boolean; detail?: string }[] = [];
const check = (group: string, name: string, ok: boolean, detail?: string) => {
	checks.push({ group, check: name, ok, detail });
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${group}: ${name}${detail === undefined || detail === "" ? "" : ` (${detail})`}`,
	);
};
const note = (text: string) => console.log(`      ${text}`);
const transcript: string[] = [];

interface Run {
	lines: Line[];
	/** One per finished step, in order. */
	results: Line[];
	/** The bridge's session sync decisions, one per fresh Claude Code query: clean-start, rebuild or reuse. */
	paths: string[];
	log: string;
	signal: NodeJS.Signals | null;
}

/** Run steps in one host process. `kill` sees each line and returns true to SIGKILL the host's process group. */
function host(
	group: string,
	steps: Step[],
	options: { kill?: (line: Line) => boolean; env?: Record<string, string> } = {},
): Promise<Run> {
	const from = existsSync(bridgeLog) ? readFileSync(bridgeLog, "utf8").length : 0;
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [join(import.meta.dirname, "host.ts"), stateDir, JSON.stringify(steps)], {
			env: { ...process.env, CLAUDE_BRIDGE_DEBUG: "1", CLAUDE_BRIDGE_DEBUG_PATH: bridgeLog, ...options.env },
			stdio: ["ignore", "pipe", "pipe"],
			// Its own process group, so a kill takes Claude Code and the tools' children with
			// it, as systemd's control-group kill would.
			detached: true,
		});
		const lines: Line[] = [];
		let buffer = "";
		let killed = false;
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
				const text = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				transcript.push(`[${group}] ${text}`);
				const line = JSON.parse(text) as Line;
				lines.push(line);
				if (!killed && options.kill?.(line) === true && child.pid !== undefined) {
					killed = true;
					process.kill(-child.pid, "SIGKILL");
				}
			}
		});
		child.stderr.on("data", (chunk: Buffer) => transcript.push(`[${group} stderr] ${chunk}`));
		child.on("exit", (_code, signal) => {
			const log = existsSync(bridgeLog) ? readFileSync(bridgeLog, "utf8").slice(from) : "";
			const paths = [...log.matchAll(/syncResult: path=(\S+)/g)].map((match) => match[1] ?? "");
			resolve({ lines, results: lines.filter((line) => line.t === "result"), paths, log, signal });
		});
	});
}

type Answer = { stopReason: string; text: string; errorMessage?: string };
const answer = (result: Line | undefined) => result?.answer as Answer | undefined;
const text = (result: Line | undefined) => answer(result)?.text ?? "";
const done = (result: Line | undefined) => result?.status === "done";
const marked = (result: Line | undefined) => text(result).trimEnd().endsWith(MARKER);
const turn = (conv: string, requestId: string, text: string): Extract<Step, { op: "turn" }> => ({
	op: "turn",
	conv,
	requestId,
	text,
});
const noTools = (question: string) => `Without using any tools: ${question}`;

// 1. A turn with several tool calls.
{
	const group = "tools";
	const run = await host(group, [
		turn(
			"root",
			"tools",
			"Create notes.txt containing exactly three lines, alpha, beta and gamma, with the write tool. " +
				"Then read it back with the read tool, then run `wc -l notes.txt` with bash. Report the line count.",
		),
	]);
	const used = run.lines.filter((line) => line.t === "tool_start").map((line) => String(line.tool));
	check(group, "turn answered", done(run.results[0]), String(run.results[0]?.reason ?? ""));
	check(
		group,
		"write, read and bash all ran",
		["write", "read", "bash"].every((tool) => used.includes(tool)),
		used.join(","),
	);
	check(group, "no tool errors", !run.lines.some((line) => line.t === "tool_end" && line.isError === true));
	check(group, "AGENTS.md reached Claude Code", marked(run.results[0]));
}

// 2. kill -9 mid-tool, reopen, resume.
{
	const group = "crash";
	let submission: unknown;
	const crashed = await host(
		group,
		[
			turn(
				"root",
				"crash",
				"Run exactly this bash command and nothing else first: `sleep 20; echo done > slept.txt`. " +
					"When it has finished, tell me whether slept.txt exists.",
			),
		],
		{
			kill: (line) => {
				if (line.t === "submitted") submission = line.id;
				return line.t === "tool_start" && JSON.stringify(line.args).includes("sleep");
			},
		},
	);
	check(
		group,
		"host killed mid-tool",
		crashed.signal === "SIGKILL" && crashed.results.length === 0,
		`signal=${crashed.signal}`,
	);
	const left = processesIn(workspace);
	check(group, "nothing left running in the workspace", left.length === 0, left.join("; "));
	const resumed = await host(`${group}/resume`, [{ op: "resume", conv: "root", submission: submission as never }]);
	const result = resumed.results[0];
	check(group, "turn finished after restart, unprompted", done(result), String(result?.reason ?? ""));
	check(group, "AGENTS.md still reached Claude Code", marked(result));
	check(
		group,
		"bridge rebuilt Claude Code's session from Durable's history",
		resumed.paths[0] === "rebuild",
		resumed.paths.join(","),
	);
	const interrupted = resumed.lines.find((line) => line.t === "tool_end" && line.isError === true);
	note(
		`interrupted tool result: ${interrupted === undefined ? "not seen (written before the watch attached)" : JSON.stringify(interrupted.text)}`,
	);
	note(`answer: ${JSON.stringify(text(result))}`);
}

// 3. Esc mid-tool: abort while bash runs, so no request is streaming, then carry on in
//    the same process.
{
	const group = "esc";
	const run = await host(group, [
		{
			...turn(
				"root",
				"esc",
				"Run exactly this bash command and nothing else first: `sleep 30`. Then say what it printed.",
			),
			abortOnTool: "sleep",
		},
		{ op: "processes", conv: "root", waitMs: 3000 },
		turn("root", "after-esc", noTools("in one sentence, what did I just ask you to run?")),
	]);
	const [aborted, processes, after] = run.results;
	check(
		group,
		"turn ended as aborted",
		aborted?.status === "unanswered" && aborted.reason === "aborted",
		`${aborted?.status} ${aborted?.reason}`,
	);
	check(group, "the bridge closed its Claude Code query", run.log.includes("abort detected"));
	const left = (processes?.processes as string[] | undefined) ?? ["(no result)"];
	check(group, "nothing left running in the workspace while the daemon lives on", left.length === 0, left.join("; "));
	check(group, "next turn answered", done(after), String(after?.reason ?? ""));
	check(
		group,
		"next turn was a fresh query, not one re-entering a parked query",
		!run.log.includes("isReentrant=true"),
	);
	check(
		group,
		"the bridge rebuilt Claude Code's session after the abort",
		run.paths.at(-1) === "rebuild",
		run.paths.join(","),
	);
	check(group, "AGENTS.md still reached Claude Code", marked(after));
	note(`answer: ${JSON.stringify(text(after))}`);
}

// 4. Compact mid-conversation and continue, in one process, so the bridge holds a
//    Claude Code session it could wrongly keep resuming.
{
	const group = "compact";
	const run = await host(group, [
		turn("root", "warm-1", noTools("in one sentence, what have we done so far?")),
		turn("root", "warm-2", noTools("how many lines did notes.txt have?")),
		{ op: "compact", conv: "root", instructions: "Keep the names of files created and their exact contents." },
		turn("root", "after-compact", noTools("what were the three lines you wrote to notes.txt?")),
	]);
	const [warm1, warm2, compacted, after] = run.results;
	check(group, "turns before compaction answered", done(warm1) && done(warm2));
	check(
		group,
		"bridge resumed its Claude Code session between turns (prompt cache kept)",
		run.paths[1] === "reuse",
		run.paths.join(","),
	);
	const outcome = compacted?.outcome as { status: string; result?: { submissionId?: unknown } } | undefined;
	check(
		group,
		"compaction produced a summary",
		outcome?.status === "completed" && outcome.result?.submissionId !== undefined,
		JSON.stringify(outcome),
	);
	check(group, "summary went through the bridge's isolated path", run.log.includes("routed to isolated summary"));
	check(group, "shim marked the rewrite", run.log.includes("session_compact:rewrite"));
	check(group, "bridge rebuilt instead of resuming stale history", run.paths[2] === "rebuild", run.paths.join(","));
	check(group, "turn after compaction answered", done(after));
	check(
		group,
		"summary carried the facts",
		["alpha", "beta", "gamma"].every((word) => text(after).toLowerCase().includes(word)),
		JSON.stringify(text(after)),
	);
	check(group, "AGENTS.md still reached Claude Code", marked(after));
}

// 5. Fork, and continue both branches, alternating in one process.
{
	const group = "fork";
	const run = await host(group, [
		{ op: "fork", conv: "root", as: "fork" },
		turn("root", "root-1", noTools("reply with the word ALPHA and the name of the first file you created.")),
		turn("fork", "fork-1", noTools("reply with the word BETA and the name of the first file you created.")),
		turn("root", "root-2", noTools("reply with the word ALPHA again, and the number of lines in that file.")),
		turn("fork", "fork-2", noTools("reply with the word BETA again, and the number of lines in that file.")),
	]);
	const [forked, root1, fork1, root2, fork2] = run.results;
	const sessions = run.lines.filter((line) => line.t === "conversation").map((line) => line.providerSessionId);
	check(
		group,
		"fork has its own provider session",
		forked?.providerSessionId !== undefined && new Set(sessions).size === 2,
		sessions.join(" vs "),
	);
	for (const [name, result, word] of [
		["root", root1, "ALPHA"],
		["fork", fork1, "BETA"],
		["root", root2, "ALPHA"],
		["fork", fork2, "BETA"],
	] as const) {
		check(
			group,
			`${name} answered from its own history`,
			done(result) && text(result).includes(word),
			JSON.stringify(text(result)),
		);
		check(group, `${name}: AGENTS.md reached Claude Code`, marked(result));
	}
	check(
		group,
		"each branch's second turn resumed its own Claude Code session",
		run.paths[2] === "reuse" && run.paths[3] === "reuse",
		run.paths.join(","),
	);
}

// 6. Control: the same compaction without the shim's rewrite mark. Not a check of the
//    shim; it shows what the mark prevents.
{
	const group = "control";
	const run = await host(
		group,
		[
			turn("root", "control-1", noTools("in one sentence, what is in notes.txt?")),
			{ op: "compact", conv: "root", instructions: "Keep the names of files created and their exact contents." },
			turn("root", "control-2", noTools("what were the three lines you wrote to notes.txt?")),
		],
		{ env: { PIER_GATE_NO_REWRITE_MARK: "1" } },
	);
	const outcome = run.results[1]?.outcome as { status: string; result?: { submissionId?: unknown } } | undefined;
	note(
		`without the mark: compaction ${outcome?.result?.submissionId === undefined ? "made no summary" : "made a summary"}; sync paths ${run.paths.join(",")}`,
	);
	note(`answer: ${JSON.stringify(text(run.results[2]))}`);
}

// 7. Across every run.
{
	const group = "all";
	const everything = `${transcript.join("\n")}\n${existsSync(bridgeLog) ? readFileSync(bridgeLog, "utf8") : ""}`;
	check(group, "no prompt-capture failure", !/prompt-capture|prompt_capture_unresolved/.test(everything));
	check(group, "no 'out of extra usage'", !/extra usage/i.test(everything));
	const errors = transcript.filter((line) => line.includes('"errorMessage"'));
	check(group, "no assistant errors", errors.length === 0, errors.join("\n"));
	const reports = transcript.filter((line) => line.includes('"t":"report"'));
	check(group, "no Harness reports", reports.length === 0, reports.join("\n"));
	const left = processesIn(workspace);
	check(group, "nothing left running in the workspace", left.length === 0, left.join("; "));
}

writeFileSync(join(stateDir, "transcript.jsonl"), `${transcript.join("\n")}\n`);
writeFileSync(join(stateDir, "checks.json"), JSON.stringify(checks, null, "\t"));
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. State: ${stateDir}`);
process.exitCode = failed.length === 0 ? 0 : 1;

/** Live processes whose working directory is under `dir`: what a crash leaves running. */
function processesIn(dir: string): string[] {
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
