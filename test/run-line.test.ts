// The line after each run, in Durable's terms, with the facts pine-of-glass's cachemire
// prints in Will's classic pi, computed from what Durable stores; and pi's working line
// in the editor's border.
import { stripVTControlCharacters } from "node:util";
import { CustomEditor, initTheme } from "@earendil-works/pi-coding-agent";
import type { EntryId, EntryRecord } from "@earendil-works/pi-durable";
import { getKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration, runEndingAt, runLine } from "../src/host/run-line.ts";
import { installKeybindings } from "../src/host/tool-calls.ts";
import { blockedLine, blockedNotice } from "../src/host/tui.ts";
import { WorkingLine } from "../src/host/working.ts";

let id = 0;
const user = (timestamp: number) =>
	({
		id: ++id as EntryId,
		kind: "pi.user",
		model: [{ role: "user", content: "go", timestamp }],
	}) as unknown as EntryRecord;
/** A model response: with a tool call (the run goes on), or a final answer. */
const response = (
	timestamp: number,
	durationMs: number,
	tools: boolean,
	usage = { input: 2, cacheRead: 7000, cacheWrite: 900, output: 80 },
) =>
	({
		id: ++id as EntryId,
		kind: "pi.assistant",
		model: [
			{
				role: "assistant",
				content: tools
					? [{ type: "toolCall", id: `c${id}`, name: "bash", arguments: {} }]
					: [{ type: "text", text: "done" }],
				stopReason: tools ? "toolUse" : "stop",
				timestamp,
				durationMs,
				usage: { ...usage, totalTokens: 0, cost: { total: 0.01 } },
			},
		],
	}) as unknown as EntryRecord;
const result = (timestamp: number) =>
	({
		id: ++id as EntryId,
		kind: "pi.tool-result",
		model: [{ role: "toolResult", toolCallId: "c", toolName: "bash", content: [], isError: false, timestamp }],
	}) as unknown as EntryRecord;

describe("run line", () => {
	it("counts a run's turns and its time, from the user's message to the end of its final answer", () => {
		// Two turns with a bash call each, then the final answer: 3 turns in 3 s.
		const entries = [
			user(1000),
			response(1100, 900, true),
			result(2000),
			response(2010, 700, true),
			result(2710),
			response(2720, 1280, false),
		];
		const run = runEndingAt(entries, entries.length - 1);
		expect(run).toMatchObject({ turns: 3, durationMs: 3000, cacheRead: 21000, cacheWrite: 2700, output: 240 });
		if (run === undefined) throw new Error("no run");
		expect(runLine(run)).toBe("run: 3 turns · 3s · read 21.0k (100% cached) · wrote 2.7k · out 0.2k");
	});

	it("draws no line mid-run, after a failure, or when the run's start isn't loaded", () => {
		const entries = [user(0), response(10, 10, true), result(20), response(30, 10, false)];
		expect(runEndingAt(entries, 1)).toBeUndefined();
		expect(runEndingAt(entries.slice(1), 2)).toBeUndefined();
		const failed = response(40, 10, false);
		(failed.model?.[0] as { stopReason: string }).stopReason = "error";
		expect(runEndingAt([user(0), failed], 1)).toBeUndefined();
	});

	it("words a run of one turn, and a long run, with cachemire's numbers", () => {
		const entries = [user(0), response(0, 161_000, false, { input: 500, cacheRead: 0, cacheWrite: 0, output: 4200 })];
		const run = runEndingAt(entries, 1);
		if (run === undefined) throw new Error("no run");
		expect(runLine(run)).toBe("run: 1 turn · 2m41s · read 0.0k (0.0% cached) · wrote 0.0k · out 4.2k");
		expect(formatDuration(3_900_000)).toBe("1h5m");
	});
});

describe("working line", () => {
	initTheme();
	installKeybindings();
	const ui = { requestRender() {}, terminal: { rows: 24, columns: 60 } } as never;
	const editor = () =>
		new CustomEditor(
			ui,
			{
				borderColor: (text) => text,
				selectList: {
					selectedPrefix: (t) => t,
					selectedText: (t) => t,
					description: (t) => t,
					scrollInfo: (t) => t,
					noMatch: (t) => t,
				},
			},
			getKeybindings() as ConstructorParameters<typeof CustomEditor>[2],
			{ embedWorkingStatus: true },
		);
	const top = (shown: CustomEditor) => stripVTControlCharacters(shown.render(60)[0] ?? "");

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("shows pi's spinner and Working in the editor's border while a run goes, and stops it after", () => {
		const shown = editor();
		const working = new WorkingLine(ui, shown);
		expect(top(shown)).toMatch(/^─+$/u);
		working.update(true);
		expect(top(shown)).toMatch(/^── [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Working ─+$/u);
		const first = top(shown);
		vi.advanceTimersByTime(80);
		expect(top(shown)).not.toBe(first);
		working.update(false);
		expect(top(shown)).toMatch(/^─+$/u);
		// The spinner's timer is gone, or it would keep the client alive.
		expect(vi.getTimerCount()).toBe(0);
	});

	it("says a conversation is blocked in its place, still, over a run, and goes when it ends", () => {
		const shown = editor();
		const working = new WorkingLine(ui, shown);
		const tasks = [{ id: 7 as never, kind: "pi.generation", reason: "task_too_old" as const, background: false }];
		working.update(true);
		working.update({ kind: "blocked", message: blockedLine(tasks) });
		const line = top(shown);
		expect(line).toMatch(/^── ⚠ Blocked: a newer pier started it · Esc gives it up ─+$/u);
		// Nothing moves: no spinner, no timer.
		vi.advanceTimersByTime(200);
		expect(top(shown)).toBe(line);
		expect(vi.getTimerCount()).toBe(0);
		working.update({ kind: "idle" });
		expect(top(shown)).toMatch(/^─+$/u);
	});

	// Durable's remedy is the code that fits; giving a task up orphans it, without its cleanup.
	it("names each blocked task in the transcript: why, what would run it, and what Esc costs", () => {
		const notice = blockedNotice([
			{ id: 7 as never, kind: "pi.generation", reason: "task_too_old", background: false },
			{ id: 9 as never, kind: "pi.tool", reason: "missing_task", background: false },
		]);
		expect(notice).toContain("pi.generation (task 7) can't run here: a newer pier started it (task_too_old).");
		expect(notice).toContain("It waits for that newer pier, and carries on there.");
		expect(notice).toContain("pi.tool (task 9) can't run here: this pier doesn't have its code (missing_task).");
		expect(notice).toContain("It waits for a pier with the extension that defines it");
		expect(notice).toContain("Esc gives it up instead, without the cleanup its own code would do.");
		expect(
			blockedLine([
				{ id: 7 as never, kind: "a", reason: "missing_task", background: false },
				{ id: 9 as never, kind: "b", reason: "missing_task", background: false },
			]),
		).toBe("Blocked: 2 tasks can't run · Esc gives it up");
	});

	it("says a blocked background task holds nothing up, and isn't Esc's to end", () => {
		const notice = blockedNotice([{ id: 9 as never, kind: "pi.compaction", reason: "missing_task", background: true }]);
		expect(notice).toContain("It runs in the background, so the conversation goes on.");
		expect(notice).toContain("Esc doesn't reach it");
		expect(notice).not.toContain("Esc gives it up");
	});
});
