// The terminal client's footer, laid out as pi's: the directory, then token totals,
// cost and the context gauge on the left, the model and thinking level on the right.
// pi's `FooterComponent` takes classic pi's `AgentSession`, so pier draws its own from
// Durable's documents. A third line shows the Claude plan's windows, worded as
// pi-quotas words them in Will's classic pi ("5h:86% left (↺in 2h 5m)"), from the
// rate-limit diagnostic pi-claude-code puts on each model response.
import { relative, resolve, sep } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { calculateContextTokens } from "@earendil-works/pi-coding-agent";
import type { AgentState, TranscriptView, UsageState } from "@earendil-works/pi-durable";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { colorer } from "./colors.ts";

// In pi's theme colors, as pi's footer and pi-quotas draw theirs: pi's footer in its
// "dim" grey, the plan's room left in "success" green, amber and red as it runs out.
const dim = colorer("dim");
const red = colorer("error");
const yellow = colorer("warning");
const green = colorer("success");

/** What the footer draws, gathered from the view by `footerState`. */
export interface FooterState {
	cwd?: string;
	/** Summed over every model the conversation used. */
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	cost: number;
	/** The context the last model response was sent with; undefined until there is one, or after a compaction. */
	context?: number;
	contextWindow?: number;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;
	/** The plan's windows, from the newest model response that reported them. */
	plan?: readonly PlanWindow[];
	/** Charged to usage credits (extra usage) rather than the plan. */
	overage?: boolean;
}

export interface PlanWindow {
	/** pi-quotas' label: "5h", "7d". */
	label: string;
	/** 0 to 1. */
	utilization: number;
	/** Seconds since the epoch. */
	resetsAt?: number;
	status?: string;
}

/** Claude Code's names for its windows, as pi-claude-code passes them on, and pi-quotas' labels. */
const WINDOW_LABELS: Record<string, string> = { five_hour: "5h", seven_day: "7d" };

/** The plan's windows in one `claude-code.rate-limit` diagnostic's details, or undefined. */
export function planWindows(details: unknown): { windows: PlanWindow[]; overage: boolean } | undefined {
	if (details === null || typeof details !== "object") return undefined;
	const record = details as { unifiedWindows?: unknown; isUsingOverage?: unknown };
	const unified = record.unifiedWindows;
	if (unified === null || typeof unified !== "object") return undefined;
	const windows: PlanWindow[] = [];
	for (const [name, label] of Object.entries(WINDOW_LABELS)) {
		const window = (unified as Record<string, unknown>)[name] as
			| { utilization?: unknown; resetsAt?: unknown; status?: unknown }
			| undefined;
		if (window === undefined || typeof window.utilization !== "number") continue;
		windows.push({
			label,
			utilization: window.utilization,
			...(typeof window.resetsAt === "number" ? { resetsAt: window.resetsAt } : {}),
			...(typeof window.status === "string" ? { status: window.status } : {}),
		});
	}
	return windows.length === 0 ? undefined : { windows, overage: record.isUsingOverage === true };
}

/** What the footer shows of `view`. `contextWindow` comes from the daemon's model catalog. */
export function footerState(view: TranscriptView, contextWindow: number | undefined): FooterState {
	const agent = (view.docs["pi.agent"] ?? {}) as AgentState;
	const usage = (view.docs["pi.usage"] ?? { models: {} }) as UsageState;
	const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	let cost = 0;
	for (const entry of Object.values(usage.models ?? {})) {
		tokens.input += entry.input;
		tokens.output += entry.output;
		tokens.cacheRead += entry.cacheRead;
		tokens.cacheWrite += entry.cacheWrite;
		cost += entry.cost?.total ?? 0;
	}
	let context: number | undefined;
	let plan: { windows: PlanWindow[]; overage: boolean } | undefined;
	// Newest first: the last model response's context, and the newest plan windows, unless
	// a compaction came after it (then pi says "?" until the next response, as pier does).
	const items = view.items;
	let compacted = false;
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (item?.kind !== "entry") continue;
		if (item.entry.kind === "pi.compaction" || item.entry.kind === "pi.reset") compacted = true;
		const message = item.entry.model?.[0];
		if (message?.role !== "assistant") continue;
		const response = message as AssistantMessage & { diagnostics?: { type: string; details?: unknown }[] };
		if (
			context === undefined &&
			!compacted &&
			response.usage !== undefined &&
			response.stopReason !== "error" &&
			response.stopReason !== "aborted"
		) {
			const used = calculateContextTokens(response.usage);
			if (used > 0) context = used;
		}
		if (plan === undefined) {
			for (const diagnostic of response.diagnostics ?? []) {
				if (diagnostic.type === "claude-code.rate-limit") plan = planWindows(diagnostic.details) ?? plan;
			}
		}
		if ((context !== undefined || compacted) && plan !== undefined) break;
	}
	return {
		...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
		tokens,
		cost,
		...(context === undefined ? {} : { context }),
		...(contextWindow === undefined ? {} : { contextWindow }),
		...(agent.model === undefined ? {} : { model: { provider: agent.model.provider, modelId: agent.model.modelId } }),
		...(agent.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
		...(plan === undefined ? {} : { plan: plan.windows, overage: plan.overage }),
	};
}

/** pi's `formatTokens` (not exported in 1.5.2). */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** pi's `formatCwdForFooter`: the directory, with the home directory as `~`. */
export function formatCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const inHome = relative(resolve(home), resolve(cwd));
	if (inHome.startsWith("..") || resolve(home, inHome) !== resolve(cwd)) return cwd;
	return inHome === "" ? "~" : `~${sep}${inHome}`;
}

/** pi-quotas' `formatTimeRemaining`: minutes round up, so anything left is at least "1m". */
export function formatTimeRemaining(ms: number): string {
	if (ms <= 0) return "now";
	const totalMins = Math.ceil(ms / 60000);
	const totalHours = Math.floor(totalMins / 60);
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	const mins = totalMins % 60;
	if (days >= 1) return [`${days}d`, ...(hours > 0 ? [`${hours}h`] : []), ...(mins > 0 ? [`${mins}m`] : [])].join(" ");
	if (totalHours >= 1) return mins > 0 ? `${totalHours}h ${mins}m` : `${totalHours}h`;
	return `${totalMins}m`;
}

/** One plan window, as pi-quotas words it: amber from 80% used, red from 90%, as its absolute thresholds are. */
function planWindow(window: PlanWindow, now: number): string {
	const used = window.utilization * 100;
	const left = Math.max(0, Math.min(100, Math.round(100 - used)));
	const limited = window.status !== undefined && window.status !== "allowed";
	const warning = limited || used >= 90 ? red : used >= 80 ? yellow : undefined;
	// As pi-quotas: the label dim while there's room, the value green; both take the
	// warning's color once there isn't.
	const label = (warning ?? dim)(`${window.label}:`);
	const value = (warning ?? green)(`${left}% left`);
	const reset = window.resetsAt === undefined ? "" : dim(` (↺in ${formatTimeRemaining(window.resetsAt * 1000 - now)})`);
	return `${label}${value}${reset}`;
}

/** The footer's lines, as pi lays out its own, with the plan's windows as a third. */
export function footerLines(
	state: FooterState,
	width: number,
	options: { home?: string; status?: string; now?: number } = {},
): string[] {
	const now = options.now ?? Date.now();
	const where = state.cwd === undefined ? "" : formatCwd(state.cwd, options.home);
	// Each part dimmed by itself: a status in its own color (reconnecting…) would end an
	// outer dim, leaving the rest in the terminal's default.
	const heading = [options.status ?? "", where].filter((part) => part !== "");
	const first = heading.map((part) => dim(part)).join(dim(" · "));
	const lines = [truncateToWidth(first, width, dim("..."))];

	const parts: string[] = [];
	const { tokens } = state;
	if (tokens.input) parts.push(`↑${formatTokens(tokens.input)}`);
	if (tokens.output) parts.push(`↓${formatTokens(tokens.output)}`);
	if (tokens.cacheRead) parts.push(`R${formatTokens(tokens.cacheRead)}`);
	if (tokens.cacheWrite) parts.push(`W${formatTokens(tokens.cacheWrite)}`);
	// Claude Code runs on the plan, so this is what the conversation's model responses would
	// have cost at API prices, as pi's "(sub)" says.
	const subscription = state.model?.provider === "claude-code";
	if (state.cost || subscription) parts.push(`$${state.cost.toFixed(3)}${subscription ? " (sub)" : ""}`);
	const window = state.contextWindow ?? 0;
	const percent = state.context !== undefined && window > 0 ? (state.context / window) * 100 : undefined;
	const gauge = `${percent === undefined ? "?" : `${percent.toFixed(1)}%`}/${formatTokens(window)}`;
	const left = parts.map(dim).join(dim(" "));
	const gaugeText =
		percent !== undefined && percent > 90
			? red(gauge)
			: percent !== undefined && percent > 70
				? yellow(gauge)
				: dim(gauge);
	let statsLeft = left === "" ? gaugeText : `${left}${dim(" ")}${gaugeText}`;
	if (visibleWidth(statsLeft) > width) statsLeft = truncateToWidth(statsLeft, width, "...");

	const model = state.model?.modelId ?? "default model";
	const thinking =
		state.thinkingLevel === undefined
			? ""
			: state.thinkingLevel === "off"
				? " • thinking off"
				: ` • ${state.thinkingLevel}`;
	const right = `${model}${thinking}`;
	const room = width - visibleWidth(statsLeft);
	if (room >= visibleWidth(right) + 2) lines.push(statsLeft + " ".repeat(room - visibleWidth(right)) + dim(right));
	else if (room > 2) lines.push(`${statsLeft}  ${dim(truncateToWidth(right, room - 2, ""))}`);
	else lines.push(statsLeft);

	if (state.plan !== undefined && state.plan.length > 0) {
		const plan = state.plan.map((each) => planWindow(each, now));
		if (state.overage) plan.push(red("on usage credits"));
		lines.push(truncateToWidth(plan.join(" "), width, dim("...")));
	}
	return lines;
}

/** The footer as a component: `update()` it with each view; it lays out at the width it's drawn at. */
export class Footer implements Component {
	#state: FooterState | undefined;
	#status = "";
	readonly #home: string | undefined;

	constructor(home: string | undefined) {
		this.#home = home;
	}

	/** What the client is doing (ready, working, reconnecting) and which conversation, before the directory. */
	update(state: FooterState | undefined, status: string): void {
		this.#state = state;
		this.#status = status;
	}

	render(width: number): string[] {
		const inner = Math.max(1, width - 2);
		const state = this.#state ?? { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 };
		const options = this.#home === undefined ? { status: this.#status } : { status: this.#status, home: this.#home };
		return footerLines(state, inner, options).map((line) => ` ${line}`);
	}

	invalidate(): void {}
}
