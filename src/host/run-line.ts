// A line after each run, in Durable's terms, with the facts pine-of-glass's cachemire
// extension prints in Will's classic pi: `◍ run: 3 turns · 3s · read 14.8k (100% cached) ·
// wrote 2.9k · out 0.2k`. cachemire calls a run a "turn" and its turns "calls"; pier says
// what Durable says (its README, "Turn and run"): a turn is one model response and its
// tool calls, a run is the turns from an input to its final answer. cachemire is a pi
// extension, so it can't run in pier; this computes the same from what Durable stores,
// where each model response is a `pi.assistant` entry.
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";

export interface Run {
	/** Its turns: one per model response. */
	turns: number;
	/** From the user's message to the end of the final answer. */
	durationMs: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	costUsd: number;
}

/**
 * The run that `entries[index]`, a final answer, ends: back to the user message that
 * started it. Undefined for anything else: a response with tool calls (its run goes on),
 * one that failed, or a run whose start isn't loaded.
 */
export function runEndingAt(entries: readonly EntryRecord[], index: number): Run | undefined {
	const last = responseOf(entries[index]);
	if (last === undefined || last.stopReason === "error" || last.stopReason === "aborted") return undefined;
	if (last.content.some((part) => part.type === "toolCall")) return undefined;
	const run: Run = { turns: 0, durationMs: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0 };
	for (let at = index; at >= 0; at--) {
		const entry = entries[at];
		const message = entry?.model?.[0];
		if (message?.role === "user" && entry?.kind === "pi.user") {
			const end = last.timestamp + (durationOf(last) ?? 0);
			run.durationMs = Math.max(0, end - message.timestamp);
			return run;
		}
		const response = responseOf(entry);
		if (response === undefined) continue;
		run.turns += 1;
		run.input += response.usage?.input ?? 0;
		run.cacheRead += response.usage?.cacheRead ?? 0;
		run.cacheWrite += response.usage?.cacheWrite ?? 0;
		run.output += response.usage?.output ?? 0;
		run.costUsd += response.usage?.cost?.total ?? 0;
	}
	// The run's start isn't loaded (`/earlier` would bring it): no line rather than a wrong one.
	return undefined;
}

/** The line, without its `◍`, which the caller colors. */
export function runLine(run: Run): string {
	const prompt = run.input + run.cacheRead;
	const cached = prompt > 0 ? (run.cacheRead / prompt) * 100 : 0;
	return [
		`run: ${run.turns} ${run.turns === 1 ? "turn" : "turns"}`,
		formatDuration(run.durationMs),
		`read ${compactCount(run.cacheRead)} (${cached >= 99.95 ? "100" : cached.toFixed(1)}% cached)`,
		`wrote ${compactCount(run.cacheWrite)}`,
		`out ${compactCount(run.output)}`,
	].join(" · ");
}

/** The model response in `entry`, if it holds one. */
function responseOf(entry: EntryRecord | undefined): AssistantMessage | undefined {
	const message = entry?.model?.[0];
	return message?.role === "assistant" ? message : undefined;
}

/** How long the response took to stream, which Durable records; its timestamp is when it started. */
function durationOf(response: AssistantMessage): number | undefined {
	const duration = (response as { durationMs?: unknown }).durationMs;
	return typeof duration === "number" ? duration : undefined;
}

/** cachemire's `compactCount`: thousands with one decimal, millions past 999,950. */
export function compactCount(value: number): string {
	const rounded = Math.round(value);
	if (Math.abs(rounded) >= 999_950) return `${(rounded / 1_000_000).toFixed(1)}M`;
	return `${(rounded / 1000).toFixed(1)}k`;
}

/** cachemire's `formatDuration`: `3s`, `2m41s`, `1h5m`. */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rest = seconds % 60;
		return rest > 0 ? `${minutes}m${rest.toString().padStart(2, "0")}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes > 0 ? `${hours}h${restMinutes}m` : `${hours}h`;
}
