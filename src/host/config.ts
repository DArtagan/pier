// The daemon's configuration: a YAML file it owns, read once at start and checked
// against a schema. `$PIER_CONFIG`, else `$XDG_CONFIG_HOME/pier/config.yaml`. A missing
// file is an empty configuration; one that doesn't parse, or doesn't fit the schema,
// stops the daemon. `PIER_*` variables override what it says (`defaults.ts`, `paths.ts`).
//
//   model: claude-code/claude-opus-5-5   # provider/model, for new conversations
//   thinking: high                       # one of pi's thinking levels
//   skills: [/nix/store/…/share/skills/ketch]   # absolute paths, as PIER_SKILLS
//   tools:
//     variables: { GIT_CONFIG_GLOBAL: /home/will/.config/git/config-agent, PAGER: cat }
//     timeout: 600                       # seconds, a bash call's when the model sets none
//     projectWait: 60                    # seconds a call waits for the project's direnv
//
// Nix writes it on Will's hosts (`pkgs.formats.yaml`); elsewhere it's written by hand.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ModelThinkingLevelSchema } from "@earendil-works/pi-ai/providers/model-schema";
import { arr, compile, map, num, obj, opt, type Static, str, type ValidationError } from "@earendil-works/pi-schema";
import { parse } from "yaml";

const ConfigSchema = obj({
	/** The model new conversations run with, as `provider/model` (the model may have slashes of its own). */
	model: opt(str({ pattern: "^[^/]+/.+$" })),
	/** The thinking level new conversations run with. */
	thinking: opt(ModelThinkingLevelSchema),
	/** Skill directories the daemon offers beside each project's own, absolute paths (`skills.ts`). */
	skills: opt(arr(str({ pattern: "^/" }))),
	/** What a conversation's tools run with. */
	tools: opt(
		obj({
			/** Agent settings: variables every tool call gets, such as `GIT_CONFIG_GLOBAL` or `PAGER`. */
			variables: opt(map(str())),
			/** A bash call's timeout in seconds, when the model gives none. */
			timeout: opt(num({ exclusiveMinimum: 0 })),
			/**
			 * How long, in seconds, a bash call waits for its project's environment (direnv) to be
			 * evaluated before it runs without it. Default 60; 0 doesn't wait.
			 */
			projectWait: opt(num({ minimum: 0 })),
		}),
	),
});
export type Config = Static<typeof ConfigSchema>;

const validator = compile(ConfigSchema);

/** The configuration file: `$PIER_CONFIG`, else `$XDG_CONFIG_HOME/pier/config.yaml`. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PIER_CONFIG) return env.PIER_CONFIG;
	return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "pier", "config.yaml");
}

/**
 * The configuration at `path`: empty if there's no file (or it holds nothing). Throws, with
 * the path and what's wrong, if it isn't YAML or doesn't fit the schema: unknown keys
 * too, so a misspelt one isn't silently ignored.
 */
export async function readConfig(path: string): Promise<Config> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(`Can't read ${path}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
	return parseConfig(text, path);
}

/** `text`, a configuration file's contents, checked; `path` names it in errors. */
export function parseConfig(text: string, path: string): Config {
	let value: unknown;
	try {
		value = parse(text);
	} catch (error) {
		throw new Error(`${path} isn't YAML: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
	// An empty file, or one of comments only.
	if (value === null || value === undefined) return {};
	if (!validator.check(value))
		throw new Error(`${path} doesn't fit pier's configuration: ${describe(validator.errors(value))}`);
	return value;
}

function describe(errors: readonly ValidationError[]): string {
	return errors.map((error) => `${error.path === "" ? "/" : error.path} ${error.message}`).join("; ");
}

/** What the daemon read, for its log: the values, but only the names of the tools' variables. */
export function describeConfig(config: Config): string {
	const parts: string[] = [];
	if (config.model !== undefined) parts.push(`model ${config.model}`);
	if (config.thinking !== undefined) parts.push(`thinking ${config.thinking}`);
	if (config.skills !== undefined)
		parts.push(`skills ${config.skills.length === 0 ? "(none)" : config.skills.join(" ")}`);
	const variables = Object.keys(config.tools?.variables ?? {});
	if (variables.length > 0) parts.push(`tools.variables ${variables.join(" ")}`);
	if (config.tools?.timeout !== undefined) parts.push(`tools.timeout ${config.tools.timeout}s`);
	if (config.tools?.projectWait !== undefined) parts.push(`tools.projectWait ${config.tools.projectWait}s`);
	return parts.length === 0 ? "(empty)" : parts.join(", ");
}
