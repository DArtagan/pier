// The terminal client's footer: what it takes from Durable's documents and from
// pi-claude-code's rate-limit diagnostic, and how it lays them out, as pi's and pi-quotas' do.
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { EntryId, EntryRecord, TranscriptView } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { color } from "../src/host/colors.ts";
import { footerLines, footerState, formatCwd, formatTimeRemaining, planWindows } from "../src/host/footer.ts";

// As pi-claude-code passed it on, on a model response of Will's (2026-11-16).
const rateLimit = {
	status: "allowed",
	resetsAt: 1794888000,
	rateLimitType: "five_hour",
	overageStatus: "rejected",
	overageDisabledReason: "out_of_credits",
	isUsingOverage: false,
	unifiedWindows: {
		five_hour: { utilization: 0.14, resetsAt: 1794888000, status: "allowed" },
		seven_day: { utilization: 0.08, resetsAt: 1795420800, status: "allowed" },
	},
};

let id = 0;
const response = (reported: Record<string, number> | undefined, diagnostics?: unknown[]) =>
	({
		id: ++id as EntryId,
		kind: "pi.assistant",
		model: [
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				stopReason: "stop",
				...(reported === undefined ? {} : { usage: reported }),
				...(diagnostics === undefined ? {} : { diagnostics }),
			},
		],
	}) as unknown as EntryRecord;
const compaction = () =>
	({
		id: ++id as EntryId,
		kind: "pi.compaction",
		model: [{ role: "user", content: "summary" }],
	}) as unknown as EntryRecord;
const view = (entries: EntryRecord[]) =>
	({
		items: entries.map((entry) => ({ kind: "entry", entry })),
		docs: {
			"pi.agent": {
				cwd: "/home/will/repositories/pier",
				model: { provider: "claude-code", modelId: "claude-opus-5-5" },
				thinkingLevel: "high",
			},
			"pi.usage": {
				models: {
					"claude-code/claude-opus-5-5": {
						input: 12,
						output: 3400,
						cacheRead: 250000,
						cacheWrite: 9000,
						totalTokens: 262412,
						cost: { input: 0, output: 0.08, cacheRead: 0.05, cacheWrite: 0.01, total: 0.14 },
					},
				},
				tools: {},
			},
		},
	}) as unknown as TranscriptView;
const usage = { input: 2, output: 300, cacheRead: 50000, cacheWrite: 700, totalTokens: 51002 };
const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line));
const NOW = (1794888000 - 2 * 3600 - 5 * 60) * 1000;

describe("footer", () => {
	initTheme();

	it("takes the plan's windows from pi-claude-code's rate-limit diagnostic", () => {
		expect(planWindows(rateLimit)).toEqual({
			windows: [
				{ label: "5h", utilization: 0.14, resetsAt: 1794888000, status: "allowed" },
				{ label: "7d", utilization: 0.08, resetsAt: 1795420800, status: "allowed" },
			],
			overage: false,
		});
		expect(planWindows({ status: "allowed" })).toBeUndefined();
		expect(planWindows(undefined)).toBeUndefined();
	});

	it("lays out pi's two lines, and the plan's windows as pi-quotas words them", () => {
		const state = footerState(
			view([response(usage, [{ type: "claude-code.rate-limit", timestamp: 0, details: rateLimit }])]),
			200000,
		);
		const lines = plain(footerLines(state, 100, { home: "/home/will", status: "ready · #3", now: NOW }));
		expect(lines[0]).toBe("ready · #3 · ~/repositories/pier");
		expect(lines[1]).toMatch(/^↑12 ↓3\.4k R250k W9\.0k \$0\.140 \(sub\) 25\.5%\/200k +claude-opus-5-5 • high$/u);
		expect(lines[1]).toHaveLength(100);
		expect(lines[2]).toBe("5h:86% left (↺in 2h 5m) 7d:92% left (↺in 6d 6h 5m)");
	});

	it("says ? for the context after a compaction, until the next model response, as pi does", () => {
		const compacted = footerState(view([response(usage), compaction()]), 200000);
		expect(compacted.context).toBeUndefined();
		expect(plain(footerLines(compacted, 100))[1]).toContain(" ?/200k");
		const answered = footerState(
			view([response(usage), compaction(), response({ ...usage, totalTokens: 20000 })]),
			200000,
		);
		expect(answered.context).toBe(20000);
	});

	it("turns the gauge and a window amber, then red, as they fill", () => {
		const nearlyFull = footerState(view([response({ ...usage, totalTokens: 190000 })]), 200000);
		expect(footerLines(nearlyFull, 100)[1]).toContain(color("error", "95.0%/200k"));
		const filling = {
			...rateLimit,
			unifiedWindows: { five_hour: { utilization: 0.85, resetsAt: 1794888000, status: "allowed" } },
		};
		const amber = footerState(view([response(usage, [{ type: "claude-code.rate-limit", details: filling }])]), 200000);
		expect(footerLines(amber, 100, { now: NOW })[2]).toContain(color("warning", "15% left"));
		const charged = { ...rateLimit, isUsingOverage: true };
		const credits = footerState(
			view([response(usage, [{ type: "claude-code.rate-limit", details: charged }])]),
			200000,
		);
		expect(plain(footerLines(credits, 100, { now: NOW }))[2]).toContain("on usage credits");
	});

	it("draws the footer in pi's grey, and the plan's room left in green, as pi and pi-quotas do", () => {
		const state = footerState(
			view([response(usage, [{ type: "claude-code.rate-limit", timestamp: 0, details: rateLimit }])]),
			200000,
		);
		const lines = footerLines(state, 100, { home: "/home/will", status: "ready", now: NOW });
		// Every line starts in pi's dim grey; the plan's value is in its success green.
		const grey = color("dim", "|").split("|")[0] ?? "";
		expect(grey).not.toBe("");
		for (const line of lines) expect(line.startsWith(grey)).toBe(true);
		expect(lines[1]).toContain(color("dim", "↑12"));
		expect(lines[2]).toContain(color("success", "86% left"));
		expect(lines[2]).toContain(color("dim", "5h:"));
	});

	it("draws no plan line without the diagnostic, and fits a narrow terminal", () => {
		const state = footerState(view([response(usage)]), undefined);
		expect(plain(footerLines(state, 100))[1]).toContain(" ?/0 ");
		const lines = plain(footerLines(state, 30));
		expect(lines).toHaveLength(2);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
	});

	it("shortens the home directory as pi does, and only that", () => {
		expect(formatCwd("/home/will", "/home/will")).toBe("~");
		expect(formatCwd("/home/will/src", "/home/will")).toBe("~/src");
		expect(formatCwd("/home/willow", "/home/will")).toBe("/home/willow");
		expect(formatCwd("/tmp", "/home/will")).toBe("/tmp");
	});

	it("words time left as pi-quotas does", () => {
		expect(formatTimeRemaining(0)).toBe("now");
		// Minutes round up, as pi-quotas' do: anything left is at least "1m".
		expect(formatTimeRemaining(30_000)).toBe("1m");
		expect(formatTimeRemaining(5 * 60_000)).toBe("5m");
		expect(formatTimeRemaining(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
		expect(formatTimeRemaining(3 * 86_400_000)).toBe("3d");
	});
});
