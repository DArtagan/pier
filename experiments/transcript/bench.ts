// How the terminal client copes with a long transcript: pier's own work on each update
// from the daemon (`fillTranscript`), and pi-tui's frame after it, fullscreen and
// regular, while an answer streams at the end of N stored entries. Also the first frame
// after N new entries arrive at once (as `/earlier` brings them), and the heap.
//   node --expose-gc experiments/transcript/bench.ts [entries…]
// Modelled on pi-tui's own test/alt-screen-large-transcript-bench.ts, but on pier's code.
import { performance } from "node:perf_hooks";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { getMarkdownTheme, getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { EntryId, EntryRecord, LiveState, TranscriptView } from "@earendil-works/pi-durable";
import {
	type Component,
	Container,
	Editor,
	type Terminal,
	Text,
	TuiAltScreen,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { chatLayout, fillTranscript } from "../../src/host/tui.ts";

const COLUMNS = 120;
const ROWS = 50;
const STREAM_UPDATES = 200;

class NullTerminal implements Terminal {
	columns = COLUMNS;
	rows = ROWS;
	start(): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(): void {}
	get kittyProtocolActive(): boolean {
		return false;
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
	setProgramStatus(): void {}
}

const answer = [
	"Here's what I found. The **transcript** is rebuilt on each update, and the `Container` concatenates",
	"every child's lines on each frame, which is linear in the transcript's length.",
	"",
	"```ts",
	"for (const item of view.items) {",
	"  let component = rendered.get(item.entry.id);",
	"  if (component === undefined) rendered.set(item.entry.id, (component = renderEntry(item.entry)));",
	"  transcript.addChild(component);",
	"}",
	"```",
	"",
	"- the first point, with enough words to wrap at a realistic terminal width of a hundred and twenty columns",
	"- the second point",
].join("\n");
const output = Array.from(
	{ length: 20 },
	(_, line) => `src/host/file-${line}.ts:${line * 7}: matched a line of output`,
).join("\n");

const assistant = (content: AssistantMessage["content"]): AssistantMessage =>
	({ role: "assistant", content, stopReason: "stop" }) as AssistantMessage;

/** One turn's entries: a request, an answer with two tool calls, their results, and a closing answer. */
function turn(first: number): EntryRecord[] {
	const messages: Message[] = [
		{ role: "user", content: `Request ${first}: look into how the transcript renders`, timestamp: 0 },
		assistant([
			{ type: "thinking", thinking: "I should read the renderer first, then measure it." },
			{ type: "text", text: answer },
			{ type: "toolCall", id: "a", name: "bash", arguments: { command: "rg -n render src/host" } },
			{ type: "toolCall", id: "b", name: "read", arguments: { path: "src/host/tui.ts" } },
		]),
		{
			role: "toolResult",
			toolCallId: "a",
			toolName: "bash",
			content: [{ type: "text", text: output }],
			isError: false,
			timestamp: 0,
		},
		{
			role: "toolResult",
			toolCallId: "b",
			toolName: "read",
			content: [{ type: "text", text: output }],
			isError: false,
			timestamp: 0,
		},
		assistant([{ type: "text", text: answer }]),
	] as Message[];
	return messages.map(
		(message, index) =>
			({ id: (first + index) as EntryId, kind: `pi.${message.role}`, model: [message] }) as unknown as EntryRecord,
	);
}

function entries(count: number): EntryRecord[] {
	const all: EntryRecord[] = [];
	while (all.length < count) all.push(...turn(all.length + 1));
	return all.slice(0, count);
}

function viewOf(stored: readonly EntryRecord[], streamed: string | undefined): TranscriptView {
	const live: LiveState =
		streamed === undefined
			? {}
			: ({ run: {}, generation: { message: assistant([{ type: "text", text: streamed }]) } } as unknown as LiveState);
	return {
		items: stored.map((entry) => ({ kind: "entry", entry })),
		docs: { "pi.live": live },
	} as unknown as TranscriptView;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
const ms = (value: number) => value.toFixed(2).padStart(7);
const gc = () => (globalThis as { gc?: () => void }).gc?.();

initTheme();
const markdown = getMarkdownTheme();

function run(mode: "fullscreen" | "regular", count: number): string {
	const terminal = new NullTerminal();
	const tui =
		mode === "fullscreen"
			? new TuiAltScreen(terminal, false, "/tmp/pier-bench")
			: new TuiMainScreen(terminal, false, "/tmp/pier-bench");
	const transcript = new Container();
	const notices = new Text("", 1, 0);
	const status = new Text("ready · model · #1", 1, 0);
	const editor = new Editor(tui, { borderColor: (text) => text, selectList: getSelectListTheme() });
	const parts: Component[] = [transcript, notices, status, editor];
	for (const part of parts) tui.addChild(part);
	if (tui instanceof TuiAltScreen) tui.setLayoutRoot(chatLayout(transcript, [notices, status], editor));
	tui.start();

	const stored = entries(count);
	const rendered = new Map<EntryId, Component>();
	gc();
	const heapBefore = process.memoryUsage().heapUsed;

	// The first frame with every entry new, as after /earlier or a long catch-up.
	let start = performance.now();
	fillTranscript(transcript, viewOf(stored, undefined), rendered, markdown);
	tui.renderNow();
	const cold = performance.now() - start;
	const lines = transcript.render(COLUMNS).length;

	// An answer streaming at the end: each update from the daemon refills the transcript,
	// and pi-tui draws a frame (at most one per 16 ms in use; here, one per update).
	const fills: number[] = [];
	const frames: number[] = [];
	let streamed = "";
	for (let update = 0; update < STREAM_UPDATES; update++) {
		streamed += update % 12 === 11 ? "\n\n" : `word${update} `;
		const view = viewOf(stored, streamed);
		start = performance.now();
		fillTranscript(transcript, view, rendered, markdown);
		const filled = performance.now();
		tui.renderNow();
		fills.push(filled - start);
		frames.push(performance.now() - filled);
	}
	gc();
	const heap = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
	tui.stop();
	return [
		mode.padEnd(10),
		String(count).padStart(6),
		String(lines).padStart(7),
		ms(cold),
		ms(median(fills)),
		ms(p95(fills)),
		ms(median(frames)),
		ms(p95(frames)),
		`${heap.toFixed(1).padStart(7)}`,
	].join("  ");
}

const counts = process.argv
	.slice(2)
	.map(Number)
	.filter((count) => count > 0);
console.log(
	`${COLUMNS}x${ROWS}, ${STREAM_UPDATES} streamed updates; times in ms, heap in MiB${(globalThis as { gc?: unknown }).gc ? "" : " (run with --expose-gc for the heap)"}`,
);
console.log("mode         entries    lines     cold  fill p50  fill p95  frame p50 frame p95     heap");
for (const count of counts.length > 0 ? counts : [100, 1000, 3000, 10000]) {
	for (const mode of ["fullscreen", "regular"] as const) console.log(run(mode, count));
}
