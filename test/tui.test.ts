// The terminal client's parts that need no terminal: pi's `--tui-mode` flag, filling the
// transcript, which long conversations depend on staying cheap, and tool calls as pi
// draws them.
import { stripVTControlCharacters } from "node:util";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
	createBashToolDefinition,
	getMarkdownTheme,
	initTheme,
	SettingsManager,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import type { EntryId, EntryRecord, LiveState, TranscriptView } from "@earendil-works/pi-durable";
import {
	type Component,
	Container,
	setCapabilityOverrides,
	type Terminal,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTheme } from "../src/host/theme.ts";
import { installKeybindings, isExpandKey, isThinkingKey, ToolCalls } from "../src/host/tool-calls.ts";
import { compactionSummary, fillTranscript, TranscriptStyle, takeTuiMode } from "../src/host/tui.ts";

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
	it("reuses stored entries' components on each update, and draws the streaming response anew", () => {
		const transcript = new Container();
		const rendered = new Map<EntryId, Component>();
		const style = new TranscriptStyle(markdown, new ToolCalls(ui, "/tmp"));
		fillTranscript(transcript, view(3, "streaming"), rendered, style);
		const stored = transcript.children.slice(0, 3);
		fillTranscript(transcript, view(4, "streaming more"), rendered, style);
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
		fillTranscript(transcript, view(stored, live), new Map(), new TranscriptStyle(markdown, tools));
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
		const response = call("b2", "bash", { command: "sleep 20" });
		const running = {
			run: {},
			tools: [{ callId: "b2", name: "bash", status: "running", output: "partial out" }],
		} as unknown as LiveState;
		const shown = fill(tools, [response], running);
		expect(shown).toContain("$ sleep 20");
		expect(shown).toContain("partial out");
		expect(shown).toContain("Elapsed");
		expect(tools.running).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
		// The run was aborted, or the tool's task faulted: the slot is gone, and no result came.
		fill(tools, [response], {});
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
		const response = call("r1", "read", { path: "/tmp/f.txt" });
		const stored = result("r1", "read", "file contents");
		const transcript = new Container();
		const rendered = new Map<EntryId, Component>();
		fillTranscript(transcript, view([stored]), rendered, new TranscriptStyle(markdown, tools));
		expect(show(transcript)).toContain("file contents");
		fillTranscript(transcript, view([response, stored]), rendered, new TranscriptStyle(markdown, tools));
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

describe("answers, thinking and summaries", () => {
	initTheme();
	installKeybindings();
	const markdown = getMarkdownTheme();
	const show = (container: Container) => stripVTControlCharacters(container.render(100).join("\n"));
	const entry = (id: number, kind: string, message: unknown) =>
		({ id: id as EntryId, kind, model: [message] }) as unknown as EntryRecord;
	const answer = entry(2, "pi.assistant", {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "First I weigh it.\nThen I decide." },
			{ type: "text", text: "The **answer** is 42." },
		],
		stopReason: "stop",
	});
	const fill = (style: TranscriptStyle, entries: EntryRecord[], live: LiveState = {}) => {
		const transcript = new Container();
		const view = {
			items: entries.map((stored) => ({ kind: "entry", entry: stored })),
			docs: { "pi.live": live },
		} as unknown as TranscriptView;
		fillTranscript(transcript, view, new Map(), style);
		return transcript;
	};

	it("shows an answer's thinking whole, and Ctrl+T hides it, as pi does", () => {
		const style = new TranscriptStyle(markdown, new ToolCalls(ui, "/tmp"));
		const transcript = fill(style, [answer]);
		expect(show(transcript)).toContain("Then I decide.");
		expect(show(transcript)).toContain("The answer is 42.");
		expect(isThinkingKey("\x14")).toBe(true);
		style.setHideThinking(true);
		expect(show(transcript)).not.toContain("Then I decide.");
		expect(show(transcript)).toContain("Thinking...");
		expect(show(transcript)).toContain("The answer is 42.");
	});

	it("starts with thinking hidden when pi's hideThinkingBlock says so, the streaming response too", () => {
		const style = new TranscriptStyle(markdown, new ToolCalls(ui, "/tmp"), { hideThinking: true });
		const streaming = {
			run: {},
			generation: {
				message: { role: "assistant", content: [{ type: "thinking", thinking: "still weighing" }] },
			},
		} as unknown as LiveState;
		const transcript = fill(style, [answer], streaming);
		expect(show(transcript)).not.toContain("weigh");
		style.setHideThinking(false);
		expect(show(transcript)).toContain("still weighing");
	});

	it("updates one component as a response streams, and starts another for the next", () => {
		const style = new TranscriptStyle(markdown, new ToolCalls(ui, "/tmp"));
		const partial = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] }) as AssistantMessage;
		const first = style.streaming(partial("Hel"));
		expect(style.streaming(partial("Hello"))).toBe(first);
		style.streamEnded();
		expect(style.streaming(partial("Next"))).not.toBe(first);
	});

	it("marks user messages and model responses as prompt zones, for Ctrl+Up and Ctrl+Down", () => {
		const style = new TranscriptStyle(markdown, new ToolCalls(ui, "/tmp"));
		const user = entry(1, "pi.user", { role: "user", content: "what is it?" });
		const lines = fill(style, [user, answer]).render(100).join("\n");
		expect(lines.split("\x1b]133;A\x07").length - 1).toBe(2);
	});

	it("shows a compaction as pi's collapsed summary, and Ctrl+O shows the summary itself", () => {
		const style = new TranscriptStyle(markdown, new ToolCalls(ui, "/tmp"));
		const text =
			"The conversation history before this point was compacted into the following summary:\n\n<summary>\n## Goal\nShip it.\n</summary>";
		const compaction = entry(3, "pi.compaction", {
			role: "user",
			content: [{ type: "text", text }],
		});
		expect(compactionSummary(compaction.model?.[0])).toBe("## Goal\nShip it.");
		const used = entry(2, "pi.assistant", {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			stopReason: "stop",
			usage: { input: 10, output: 5, cacheRead: 145000, cacheWrite: 0, totalTokens: 145015 },
		});
		// With no model response before it loaded, pier can't say what it summarized: a rule, not "0 tokens".
		expect(show(fill(style, [compaction]))).toContain("earlier messages were summarized");
		const transcript = fill(style, [used, compaction]);
		expect(show(transcript)).toContain("[compaction]");
		expect(show(transcript)).toContain("Compacted from 145,015 tokens");
		expect(show(transcript)).not.toContain("Ship it.");
		style.setExpanded(true);
		expect(show(transcript)).toContain("Ship it.");
		expect(show(transcript)).not.toContain("<summary>");
	});
});

describe("theme", () => {
	// A TUI that answers the color query as a dark terminal does.
	const answering = (colors: object) =>
		({
			requestRender() {},
			invalidate() {},
			setTerminalColorSchemeNotifications() {},
			onTerminalColorSchemeChange: () => () => {},
			queryTerminalColors: async () => colors,
		}) as unknown as Parameters<typeof startTheme>[0];
	const dark = { background: { r: 24, g: 24, b: 24 }, foreground: { r: 220, g: 220, b: 220 } };
	/** A finished bash call's first line inside its block, where pi paints the block's background. */
	const panel = () => {
		const component = new ToolExecutionComponent(
			"bash",
			"x",
			{ command: "ls" },
			{},
			createBashToolDefinition("/tmp"),
			ui,
			"/tmp",
		);
		component.updateResult({ content: [{ type: "text", text: "a" }], isError: false, durationMs: 1 });
		return component.render(20)[1] ?? "";
	};
	// Escape codes for a background: an exact color (`ESC[48;2;R;G;Bm`), the nearest of the
	// terminal's 256 (`ESC[48;5;Nm`), or the terminal's own default, no color (`ESC[49m`).
	const TRUE_COLOR = "\x1b[48;2;";
	const COLORS_256 = "\x1b[48;5;";
	const DEFAULT = "\x1b[49m";

	afterEach(() => {
		// Back to what the environment says, and pi's theme without the terminal's colors.
		setCapabilityOverrides({});
		initTheme();
	});

	it("colors tool blocks with pi's exact shade, where the terminal takes 24-bit color", async () => {
		setCapabilityOverrides({ trueColor: true });
		const stop = await startTheme(answering(dark), SettingsManager.inMemory(), () => {});
		try {
			expect(panel()).toContain(TRUE_COLOR);
		} finally {
			stop();
		}
	});

	it("colors them with the nearest of 256, where it doesn't", async () => {
		setCapabilityOverrides({ trueColor: false });
		const stop = await startTheme(answering(dark), SettingsManager.inMemory(), () => {});
		try {
			expect(panel()).toContain(COLORS_256);
			expect(panel()).not.toContain(TRUE_COLOR);
		} finally {
			stop();
		}
	});

	it("starts within pi's timeout, uncolored, when the terminal never answers", async () => {
		setCapabilityOverrides({ trueColor: true });
		// A real pi-tui screen on a terminal that swallows the query, as a tmux pane no
		// client shows did: pi-tui gives up after pi's 100 ms.
		const written: string[] = [];
		const silent = {
			columns: 80,
			rows: 24,
			kittyProtocolActive: false,
			start() {},
			stop() {},
			drainInput: async () => {},
			write: (data: string) => written.push(data),
			moveBy() {},
			hideCursor() {},
			showCursor() {},
			clearLine() {},
			clearFromCursor() {},
			clearScreen() {},
			setTitle() {},
			setProgress() {},
			setProgramStatus() {},
		} as unknown as Terminal;
		const screen = new TuiMainScreen(silent);
		screen.start();
		const errors: string[] = [];
		const started = performance.now();
		try {
			const stop = await startTheme(screen, SettingsManager.inMemory(), (message) => errors.push(message));
			const waited = performance.now() - started;
			try {
				// It asked (OSC 11, the background) and waited no longer than the timeout.
				expect(written.join("")).toContain("\x1b]11;?");
				expect(waited).toBeGreaterThanOrEqual(90);
				expect(waited).toBeLessThan(1000);
				// The block keeps the terminal's own background, and nothing is reported as an error.
				expect(panel()).toContain(DEFAULT);
				expect(panel()).not.toMatch(/\[48;[25];/);
				expect(errors).toEqual([]);
			} finally {
				stop();
			}
		} finally {
			screen.stop();
		}
	});
});
