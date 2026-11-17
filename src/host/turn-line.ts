// A line after each answered run, as pine-of-glass's cachemire extension draws one in
// Will's classic pi: `◍ turn: 3 calls · 3s · read 14.8k (100% cached) · wrote 2.9k · out 0.2k`.
// cachemire is a pi extension, so it can't run in pier; this computes the same from
// what Durable stores. A turn is a run: from the user's message to the answer that
// ends it; its calls are the model calls between, each a stored answer.
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";

export interface Turn {
	calls: number;
	/** From the user's message to the end of the last answer. */
	durationMs: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	costUsd: number;
}

/**
 * The turn that `entries[index]`, a final answer, ends: back to the user message that
 * started it. Undefined for anything else: an answer with tool calls (the turn goes on),
 * one that failed, or one whose start isn't loaded.
 */
export function turnEndingAt(entries: readonly EntryRecord[], index: number): Turn | undefined {
	const last = assistantOf(entries[index]);
	if (last === undefined || last.stopReason === "error" || last.stopReason === "aborted") return undefined;
	if (last.content.some((part) => part.type === "toolCall")) return undefined;
	const turn: Turn = { calls: 0, durationMs: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0 };
	for (let at = index; at >= 0; at--) {
		const entry = entries[at];
		const message = entry?.model?.[0];
		if (message?.role === "user" && entry?.kind === "pi.user") {
			const end = last.timestamp + (durationOf(last) ?? 0);
			turn.durationMs = Math.max(0, end - message.timestamp);
			return turn;
		}
		const answer = assistantOf(entry);
		if (answer === undefined) continue;
		turn.calls += 1;
		turn.input += answer.usage?.input ?? 0;
		turn.cacheRead += answer.usage?.cacheRead ?? 0;
		turn.cacheWrite += answer.usage?.cacheWrite ?? 0;
		turn.output += answer.usage?.output ?? 0;
		turn.costUsd += answer.usage?.cost?.total ?? 0;
	}
	// The turn's start isn't loaded (`/earlier` would bring it): no line rather than a wrong one.
	return undefined;
}

/** cachemire's line, without its `◍`, which the caller colors. */
export function turnLine(turn: Turn): string {
	const prompt = turn.input + turn.cacheRead;
	const cached = prompt > 0 ? (turn.cacheRead / prompt) * 100 : 0;
	return [
		`turn: ${turn.calls} ${turn.calls === 1 ? "call" : "calls"}`,
		formatDuration(turn.durationMs),
		`read ${compactCount(turn.cacheRead)} (${cached >= 99.95 ? "100" : cached.toFixed(1)}% cached)`,
		`wrote ${compactCount(turn.cacheWrite)}`,
		`out ${compactCount(turn.output)}`,
	].join(" · ");
}

function assistantOf(entry: EntryRecord | undefined): AssistantMessage | undefined {
	const message = entry?.model?.[0];
	return message?.role === "assistant" ? message : undefined;
}

/** How long the answer took to stream, which pi-claude-code doesn't record; its timestamp is when it started. */
function durationOf(answer: AssistantMessage): number | undefined {
	const duration = (answer as { durationMs?: unknown }).durationMs;
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
