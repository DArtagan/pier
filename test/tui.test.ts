// The terminal client's parts that need no terminal: pi's `--tui-mode` flag, and filling
// the transcript, which long conversations depend on staying cheap.
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { EntryId, EntryRecord, TranscriptView } from "@earendil-works/pi-durable";
import { type Component, Container } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { fillTranscript, takeTuiMode } from "../src/host/tui.ts";

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
		fillTranscript(transcript, view(3, "streaming"), rendered, markdown);
		const stored = transcript.children.slice(0, 3);
		fillTranscript(transcript, view(4, "streaming more"), rendered, markdown);
		expect(transcript.children.slice(0, 3).every((child, index) => child === stored[index])).toBe(true);
		expect(rendered.size).toBe(4);
		expect(text(transcript)).toContain("message 4");
		expect(text(transcript)).toContain("streaming more");
	});
});
