// The terminal client's parts that need no terminal: pi's `--tui-mode` flag, filling the
// transcript, which long conversations depend on staying cheap, and tool calls as pi
// draws them.
import { stripVTControlCharacters } from "node:util";
import type { Message } from "@earendil-works/pi-ai";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { EntryId, EntryRecord, LiveState, TranscriptView } from "@earendil-works/pi-durable";
import { type Component, Container } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installKeybindings, isExpandKey, ToolCalls } from "../src/host/tool-calls.ts";
import { fillTranscript, takeTuiMode } from "../src/host/tui.ts";

const ui = { requestRender() {} } as unknown as ConstructorParameters<typeof ToolCalls>[0];

describe("takeTuiMode", () => {
	it("is fullscreen unless told otherwise, as pi is", () => {
		expect(takeTuiMode(["resume", "3"])).toEqual({ mode: "fullscreen", rest: ["resume", "3"] });
	});

	it("takes pi's --tui-mode, before or after the command", () => {
		expect(takeTuiMode(["--tui-mode", "regular", "new"])).toEqual({ mode: "regular", rest: ["new"] });
		expect(takeTuiMode(["resume", "3", "--tui-mode", "regular"])).toEqual({ mode: "regular", rest: ["resume", "3"] });
		expect(takeTuiMode(["--tui-mode", "fullscreen"])).toEqual({ mode: "fullscreen", rest: [] });
	});

	it("refuses a mode pi doesn't have, or none", () => {
		expect(takeTuiMode(["--tui-mode", "alt"])).toEqual({ error: "--tui-mode requires regular or fullscreen" });
		expect(takeTuiMode(["--tui-mode"])).toEqual({ error: "--tui-mode requires regular or fullscreen" });
	});
});

describe("fillTranscript", () => {
	initTheme();
	const markdown = getMarkdownTheme();
	const entry = (id: number) =>
		({
			id: id as EntryId,
			kind: "pi.user",
			model: [{ role: "user", content: `message ${id}` }],
		}) as unknown as EntryRecord;
	const view = (count: number, streamed: string) =>
		({
			items: Array.from({ length: count }, (_, index) => ({ kind: "entry", entry: entry(index + 1) })),
			docs: {
				"pi.live": {
					run: {},
					generation: { message: { role: "assistant", content: [{ type: "text", text: streamed }] } },
				},
			},
		}) as unknown as TranscriptView;
	const text = (container: Container) => container.render(80).join("\n");

	// Each update from the daemon refills the transcript; only the live state is drawn anew
	// (experiments/transcript/bench.ts measures what that's worth).
	it("reuses stored entries' components on each update, and draws the streamed answer anew", () => {
		const transcript = new Container();
		const rendered = new Map<EntryId, Component>();
		const tools = new ToolCalls(ui, "/tmp");
		fillTranscript(transcript, view(3, "streaming"), rendered, markdown, tools);
		const stored = transcript.children.slice(0, 3);
		fillTranscript(transcript, view(4, "streaming more"), rendered, markdown, tools);
		expect(transcript.children.slice(0, 3).every((child, index) => child === stored[index])).toBe(true);
		expect(rendered.size).toBe(4);
		expect(text(transcript)).toContain("message 4");
		expect(text(transcript)).toContain("streaming more");
	});
});

describe("tool calls", () => {
	initTheme();
	installKeybindings();
	const markdown = getMarkdownTheme();
	const plain = (text: string) => stripVTControlCharacters(text);
	const show = (container: Container) => plain(container.render(100).join("\n"));

	let id = 0;
	const record = (message: Message) =>
		({ id: ++id as EntryId, kind: `pi.${message.role}`, model: [message] }) as unknown as EntryRecord;
	const call = (callId: string, name: string, args: Record<string, unknown>) =>
		record({
			role: "assistant",
			content: [{ type: "toolCall", id: callId, name, arguments: args }],
			stopReason: "toolUse",
		} as unknown as Message);
	const result = (callId: string, name: string, text: string, details?: unknown) =>
		record({
			role: "toolResult",
			toolCallId: callId,
			toolName: name,
			content: [{ type: "text", text }],
			details,
			isError: false,
			durationMs: 1200,
			timestamp: 0,
		} as unknown as Message);
	const view = (stored: EntryRecord[], live: LiveState = {}) =>
		({
			items: stored.map((entry) => ({ kind: "entry", entry })),
			docs: { "pi.live": live },
		}) as unknown as TranscriptView;
	const fill = (tools: ToolCalls, stored: EntryRecord[], live?: LiveState) => {
		const transcript = new Container();
		fillTranscript(transcript, view(stored, live), new Map(), markdown, tools);
		return show(transcript);
	};

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("draws an edit as the diff Durable stored", () => {
		const tools = new ToolCalls(ui, "/tmp");
		const shown = fill(tools, [
			call("e1", "edit", { path: "/nowhere/f.txt", edits: [{ oldText: "two", newText: "TWO" }] }),
			result("e1", "edit", "Successfully replaced 1 block(s)", { diff: " 1 one\n-2 two\n+2 TWO\n 3 three" }),
		]);
		expect(shown).toContain("edit /nowhere/f.txt");
		expect(shown).toContain("-2 two");
		expect(shown).toContain("+2 TWO");
		expect(shown).not.toContain("Successfully replaced");
	});

	it("collapses long output, and Ctrl+O expands it, as pi does", () => {
		const tools = new ToolCalls(ui, "/tmp");
		const lines = Array.from({ length: 30 }, (_, line) => `line ${line + 1}`).join("\n");
		const stored = [call("b1", "bash", { command: "seq 30" }), result("b1", "bash", lines)];
		const collapsed = fill(tools, stored);
		expect(collapsed).toContain("$ seq 30");
		expect(collapsed).toContain("line 30");
		expect(collapsed).not.toMatch(/line 3\s*$/m);
		expect(collapsed).toMatch(/earlier lines, ctrl\+o to expand/);
		expect(collapsed).toContain("Took 1.2s");
		expect(isExpandKey("\x0f")).toBe(true);
		tools.setExpanded(true);
		expect(fill(tools, stored)).toMatch(/line 3\s*$/m);
	});

	it("shows a running call's output under its call, and stops its clock when the slot goes without a result", () => {
		const tools = new ToolCalls(ui, "/tmp");
		const answer = call("b2", "bash", { command: "sleep 20" });
		const running = {
			run: {},
			tools: [{ callId: "b2", name: "bash", status: "running", output: "partial out" }],
		} as unknown as LiveState;
		const shown = fill(tools, [answer], running);
		expect(shown).toContain("$ sleep 20");
		expect(shown).toContain("partial out");
		expect(shown).toContain("Elapsed");
		expect(tools.running).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
		// The run was aborted, or the tool's task faulted: the slot is gone, and no result came.
		fill(tools, [answer], {});
		expect(tools.running).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("stops every clock when cleared, as when leaving", () => {
		const tools = new ToolCalls(ui, "/tmp");
		const live = {
			run: {},
			tools: [{ callId: "b3", name: "bash", status: "running", output: "x" }],
		} as unknown as LiveState;
		fill(tools, [call("b3", "bash", { command: "sleep 9" })], live);
		expect(vi.getTimerCount()).toBe(1);
		tools.clear();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("draws a result whose call isn't loaded by itself, until the call is", () => {
		const tools = new ToolCalls(ui, "/tmp");
		const answer = call("r1", "read", { path: "/tmp/f.txt" });
		const stored = result("r1", "read", "file contents");
		const transcript = new Container();
		const rendered = new Map<EntryId, Component>();
		fillTranscript(transcript, view([stored]), rendered, markdown, tools);
		expect(show(transcript)).toContain("file contents");
		fillTranscript(transcript, view([answer, stored]), rendered, markdown, tools);
		const shown = show(transcript);
		expect(shown).toContain("read /tmp/f.txt");
		// pi shows a read collapsed, without its contents.
		expect(shown).not.toContain("file contents");
	});

	it("draws a tool pi doesn't know with its arguments and output", () => {
		const tools = new ToolCalls(ui, "/tmp");
		const shown = fill(tools, [call("t1", "todoist", { query: "today" }), result("t1", "todoist", "3 tasks")]);
		expect(shown).toContain("todoist");
		expect(shown).toContain('"query": "today"');
		expect(shown).toContain("3 tasks");
	});
});
