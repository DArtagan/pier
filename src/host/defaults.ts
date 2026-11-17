// What a new conversation runs with, from the daemon's environment.
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { MODEL_THINKING_LEVELS, ModelThinkingLevelSchema } from "@earendil-works/pi-ai/providers/model-schema";
import { compile } from "@earendil-works/pi-schema";
import { CLAUDE_CODE_PROVIDER } from "../layer/claude-code.ts";

const isThinkingLevel = compile(ModelThinkingLevelSchema).check;

/** `$PIER_MODEL`, as `provider/model` (the model may have slashes of its own); else Claude Opus through Claude Code. */
export function defaultModel(env: NodeJS.ProcessEnv = process.env): { provider: string; modelId: string } {
	const spec = env.PIER_MODEL || `${CLAUDE_CODE_PROVIDER}/claude-opus-5-5`;
	const slash = spec.indexOf("/");
	if (slash <= 0 || slash === spec.length - 1) throw new Error(`PIER_MODEL is "${spec}", not provider/model`);
	return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}

/** `$PIER_THINKING`, one of pi's thinking levels; else high. */
export function defaultThinkingLevel(env: NodeJS.ProcessEnv = process.env): ModelThinkingLevel {
	const level = env.PIER_THINKING || "high";
	if (!isThinkingLevel(level)) {
		throw new Error(`PIER_THINKING is "${level}", not one of ${MODEL_THINKING_LEVELS.join(", ")}`);
	}
	return level;
}
