// What a new conversation runs with, from the daemon's environment.
import { describe, expect, it } from "vitest";
import { defaultModel, defaultThinkingLevel } from "../src/host/defaults.ts";

describe("defaultModel", () => {
	it("is Claude Opus through Claude Code, unless PIER_MODEL says otherwise", () => {
		expect(defaultModel({})).toEqual({ provider: "claude-code", modelId: "claude-opus-5-5" });
		expect(defaultModel({ PIER_MODEL: "" })).toEqual({ provider: "claude-code", modelId: "claude-opus-5-5" });
		expect(defaultModel({ PIER_MODEL: "faux/faux-1" })).toEqual({ provider: "faux", modelId: "faux-1" });
	});

	it("keeps a model's own slashes", () => {
		expect(defaultModel({ PIER_MODEL: "openrouter/anthropic/claude" })).toEqual({
			provider: "openrouter",
			modelId: "anthropic/claude",
		});
	});

	it("refuses a PIER_MODEL that isn't provider/model", () => {
		for (const spec of ["opus", "/opus", "claude-code/"]) {
			expect(() => defaultModel({ PIER_MODEL: spec })).toThrow(`PIER_MODEL is "${spec}", not provider/model`);
		}
	});
});

describe("defaultThinkingLevel", () => {
	it("is high, unless PIER_THINKING says otherwise", () => {
		expect(defaultThinkingLevel({})).toBe("high");
		expect(defaultThinkingLevel({ PIER_THINKING: "off" })).toBe("off");
	});

	it("refuses one that isn't pi's", () => {
		expect(() => defaultThinkingLevel({ PIER_THINKING: "HIGH" })).toThrow(/PIER_THINKING is "HIGH", not one of off, /u);
	});
});
