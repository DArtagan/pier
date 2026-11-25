// What a new conversation runs with: the daemon's environment, over its configuration.
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { MODEL_THINKING_LEVELS, ModelThinkingLevelSchema } from "@earendil-works/pi-ai/providers/model-schema";
import { compile } from "@earendil-works/pi-schema";
import { CLAUDE_CODE_PROVIDER } from "../layer/claude-code.ts";
import type { Config } from "./config.ts";

const isThinkingLevel = compile(ModelThinkingLevelSchema).check;

/**
 * `$PIER_MODEL`, else the configuration's `model`, as `provider/model` (the model may have
 * slashes of its own); else Claude Opus through Claude Code.
 */
export function defaultModel(
	env: NodeJS.ProcessEnv = process.env,
	config: Config = {},
): { provider: string; modelId: string } {
	const name = env.PIER_MODEL ? "PIER_MODEL" : "model";
	const spec = env.PIER_MODEL || config.model || `${CLAUDE_CODE_PROVIDER}/claude-opus-5-5`;
	const slash = spec.indexOf("/");
	if (slash <= 0 || slash === spec.length - 1) throw new Error(`${name} is "${spec}", not provider/model`);
	return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}

/** `$PIER_THINKING`, else the configuration's `thinking`: one of pi's thinking levels; else high. */
export function defaultThinkingLevel(env: NodeJS.ProcessEnv = process.env, config: Config = {}): ModelThinkingLevel {
	if (!env.PIER_THINKING) return config.thinking ?? "high";
	const level = env.PIER_THINKING;
	if (!isThinkingLevel(level)) {
		throw new Error(`PIER_THINKING is "${level}", not one of ${MODEL_THINKING_LEVELS.join(", ")}`);
	}
	return level;
}
