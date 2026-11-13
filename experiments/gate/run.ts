// The gate (step 1 in todos/): pi-claude-code on a Durable Harness, against the real
// Claude Code. Each group of steps runs host.ts in its own process; steps in one group
// share the provider's in-memory state.
//   npm run gate
// It uses your Claude Code login (`claude` on the PATH, or PI_CLAUDE_CODE_COMMAND):
// about twenty Opus turns, and a 6-minute idle (PIER_GATE_IDLE_MINUTES; 0 skips it).
// Leaves its state directory behind and prints its path.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Step } from "./host.ts";

type Line = Record<string, unknown> & { t: string };

const IDLE_MINUTES = Number(process.env.PIER_GATE_IDLE_MINUTES ?? "6");
const MARKER = "PINEAPPLE";
const stateDir = mkdtempSync(join(tmpdir(), "pier-gate-"));
const workspace = join(stateDir, "workspace");
// pi's agent dir for the gate alone, so nothing it does lands in your real one.
const agentDir = join(stateDir, "agent");
mkdirSync(workspace);
mkdirSync(agentDir);
// The model never reads this file in the gate, so the marker in its answers can only
// have come from the system prompt.
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
/** Groups whose host didn't exit by itself within its time limit, and was killed. */
const hung: string[] = [];

interface Run {
	lines: Line[];
	/** One per finished step, in order. */
	results: Line[];
	signal: NodeJS.Signals | null;
	/** Processes (the host's, and the workspace's) that outlived a kill of the host's process group. */
	survivors: string[];
}

/**
 * Run steps in one host process. `kill` sees each line and returns true to arm a SIGKILL
 * of the host's process group, sent once `killWhen` holds (polled; at once without it).
 */
function host(
	group: string,
	steps: Step[],
	options: { kill?: (line: Line) => boolean; killWhen?: () => boolean; env?: Record<string, string> } = {},
): Promise<Run> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [join(import.meta.dirname, "host.ts"), stateDir, JSON.stringify(steps)], {
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: agentDir,
				...options.env,
			},
			stdio: ["ignore", "pipe", "pipe"],
			// Its own process group, so a kill takes Claude Code with it. Durable runs each
			// tool in a process group of its own, so the kill below also takes everything in
			// the workspace, as systemd's control-group kill would.
			detached: true,
		});
		const lines: Line[] = [];
		const survivors: string[] = [];
		let buffer = "";
		let killed = false;
		// Fifteen minutes, beyond any idle steps: a host that's still running then is stuck.
		const idle = steps.reduce((total, step) => total + (step.op === "idle" ? step.ms : 0), 0);
		const guard = setTimeout(
			() => {
				hung.push(group);
				if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
			},
			idle + 15 * 60_000,
		);
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
					const pid = child.pid;
					const poll = setInterval(() => {
						if (options.killWhen !== undefined && !options.killWhen()) return;
						clearInterval(poll);
						// The host's tree before the kill: what's detached from its group is
						// reparented after it, and can't be traced back to it.
						const tree = descendantsOf(pid);
						process.kill(-pid, "SIGKILL");
						// What a process-group kill alone leaves running, then what the cgroup
						// kill takes too.
						const alive = (line: string) => existsSync(`/proc/${line.split(" ")[0]}`);
						survivors.push(...new Set([...tree.filter(alive), ...processesIn(workspace)]));
						for (const line of survivors) {
							try {
								process.kill(Number(line.split(" ")[0]), "SIGKILL");
							} catch {
								// Already gone.
							}
						}
					}, 50);
				}
			}
		});
		child.stderr.on("data", (chunk: Buffer) => transcript.push(`[${group} stderr] ${chunk}`));
		child.on("exit", (_code, signal) => {
			clearTimeout(guard);
			resolve({ lines, results: lines.filter((line) => line.t === "result"), signal, survivors });
		});
	});
}

type Usage = { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h?: number };
type Answer = { stopReason: string; text: string; errorMessage?: string; usage?: Usage };
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
/** The share of an answer's input tokens read from the prompt cache. */
const cached = (result: Line | undefined): number => {
	const usage = answer(result)?.usage;
	if (usage === undefined) return 0;
	const total = usage.input + usage.cacheRead + usage.cacheWrite;
	return total === 0 ? 0 : usage.cacheRead / total;
};
const usageOf = (result: Line | undefined): string => {
	const usage = answer(result)?.usage;
	if (usage === undefined) return "no usage";
	const share = `${Math.round(cached(result) * 100)}% cached`;
	return `${share}: input ${usage.input}, cache read ${usage.cacheRead}, cache write ${usage.cacheWrite} (1h: ${usage.cacheWrite1h ?? "?"})`;
};

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
			// Durable 1.5 shows a slot running before the call's intent is stored and the
			// tool starts; a kill then is before the call, and it rightly runs after the
			// restart. Kill once the command is really running.
			killWhen: () => processesIn(workspace).some((line) => line.includes("sleep 20")),
		},
	);
	check(
		group,
		"host killed mid-tool",
		crashed.signal === "SIGKILL" && crashed.results.length === 0,
		`signal=${crashed.signal}`,
	);
	check(group, "the command hadn't finished when killed", !existsSync(join(workspace, "slept.txt")));
	note(`outlived the host's process-group kill: ${crashed.survivors.join("; ") || "nothing"}`);
	const left = processesIn(workspace);
	check(group, "a control-group kill leaves nothing running", left.length === 0, left.join("; "));
	const resumed = await host(`${group}/resume`, [{ op: "resume", conv: "root", submission: submission as never }]);
	const result = resumed.results[0];
	check(group, "turn finished after restart, unprompted", done(result), String(result?.reason ?? ""));
	check(group, "AGENTS.md still reached Claude Code", marked(result));
	const interrupted = resumed.lines.find((line) => line.t === "tool_end" && line.isError === true);
	check(
		group,
		"the cut-off bash call came back interrupted, not run again",
		String(interrupted?.text ?? "").includes("interrupted"),
		JSON.stringify(interrupted?.text ?? "(none)"),
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
	const claudes = ((processes?.descendants as string[] | undefined) ?? []).filter((line) => line.includes("claude"));
	check(group, "no Claude Code process left running after the abort", claudes.length === 0, claudes.join("; "));
	const left = (processes?.processes as string[] | undefined) ?? ["(no result)"];
	check(group, "nothing left running in the workspace while the daemon lives on", left.length === 0, left.join("; "));
	check(group, "next turn answered", done(after), String(after?.reason ?? ""));
	check(group, "AGENTS.md still reached Claude Code", marked(after));
	note(`answer: ${JSON.stringify(text(after))}`);
}

// 4. Compact mid-conversation and continue, in one process, so the provider holds a
//    warm Claude Code process it could wrongly keep continuing.
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
	check(group, "the second turn read most of its input from the cache", cached(warm2) >= 0.5, usageOf(warm2));
	const outcome = compacted?.outcome as { status: string; result?: { submissionId?: unknown } } | undefined;
	check(
		group,
		"compaction produced a summary",
		outcome?.status === "completed" && outcome.result?.submissionId !== undefined,
		JSON.stringify(outcome),
	);
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
	for (const [name, result] of [
		["root", root2],
		["fork", fork2],
	] as const) {
		check(group, `${name}'s second turn read most of its input from the cache`, cached(result) >= 0.5, usageOf(result));
	}
}

// 6. The prompt cache across an idle conversation: two turns back to back, then a pause
//    longer than the cache's 5-minute lifetime and shorter than its 1-hour one. Measured,
//    not checked: it says which lifetime the provider's writes get.
if (IDLE_MINUTES > 0) {
	const group = "cache";
	const run = await host(group, [
		turn("root", "cache-1", noTools("in one sentence, what is in notes.txt?")),
		turn("root", "cache-2", noTools("and how many lines does it have?")),
		{ op: "idle", conv: "root", ms: IDLE_MINUTES * 60_000 },
		turn("root", "cache-3", noTools("and what is its first line?")),
	]);
	const [first, second, , third] = run.results;
	check(group, "turns answered", done(first) && done(second) && done(third));
	note(`first turn in a new process: ${usageOf(first)}`);
	note(`straight after: ${usageOf(second)}`);
	note(`after ${IDLE_MINUTES} minutes idle: ${usageOf(third)}`);
}

// 7. Across every run.
{
	const group = "all";
	// pi-claude-code fails a turn billed to Extra Usage with a "Claude Code billing" error.
	check(group, "nothing billed to Extra Usage", !/extra usage|Claude Code billing/i.test(transcript.join("\n")));
	const errors = transcript.filter((line) => line.includes('"errorMessage"'));
	check(group, "no assistant errors", errors.length === 0, errors.join("\n"));
	const reports = transcript.filter((line) => line.includes('"t":"report"'));
	check(group, "no Harness reports", reports.length === 0, reports.join("\n"));
	const left = processesIn(workspace);
	check(group, "nothing left running in the workspace", left.length === 0, left.join("; "));
	check(group, "every host exited by itself", hung.length === 0, hung.join(", "));
}

writeFileSync(join(stateDir, "transcript.jsonl"), `${transcript.join("\n")}\n`);
writeFileSync(join(stateDir, "checks.json"), JSON.stringify(checks, null, "\t"));
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. State: ${stateDir}`);
process.exitCode = failed.length === 0 ? 0 : 1;

/** Live descendants of process `root`, as `pid command line`. */
function descendantsOf(root: number): string[] {
	const parents = new Map<number, number>();
	const commands = new Map<number, string>();
	for (const name of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
		try {
			// The parent is the 2nd field after the parenthesized command, which may hold spaces.
			const stat = readFileSync(`/proc/${name}/stat`, "utf8");
			parents.set(Number(name), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]));
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
