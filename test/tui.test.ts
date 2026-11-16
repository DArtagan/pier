// The terminal client's options, which need no terminal: pi's `--tui-mode` flag.
import { describe, expect, it } from "vitest";
import { takeTuiMode } from "../src/host/tui.ts";

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
