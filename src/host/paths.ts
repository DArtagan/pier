// Where the daemon keeps its socket and its storage, and finds the skills it offers.
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { Config } from "./config.ts";

/** The daemon's Unix socket: `$PIER_SOCKET`, else `$XDG_RUNTIME_DIR/pier/pier.sock`. */
export function socketPath(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PIER_SOCKET) return env.PIER_SOCKET;
	const runtime = env.XDG_RUNTIME_DIR;
	if (!runtime) throw new Error("Neither PIER_SOCKET nor XDG_RUNTIME_DIR is set: no place for pier's socket");
	return join(runtime, "pier", "pier.sock");
}

/** The daemon's state, the SQLite storage among it: `$PIER_STATE_DIR`, else `$XDG_STATE_HOME/pier`. */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.PIER_STATE_DIR) return env.PIER_STATE_DIR;
	return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "pier");
}

/**
 * The skill directories the daemon offers, beside each project's own: `$PIER_SKILLS`,
 * absolute paths separated by `:` as in `PATH`, each one skill or a directory of them
 * (a package's `share/skills/<pname>`); else the configuration's `skills`. None when
 * neither is set. An empty `PIER_SKILLS` counts as unset.
 */
export function skillPaths(env: NodeJS.ProcessEnv = process.env, config: Config = {}): string[] {
	if (!env.PIER_SKILLS) return [...(config.skills ?? [])];
	const paths = env.PIER_SKILLS.split(delimiter).filter((path) => path !== "");
	const relative = paths.find((path) => !isAbsolute(path));
	// The daemon runs in its state directory, so a relative path would mean nothing anyone meant.
	if (relative !== undefined) throw new Error(`PIER_SKILLS holds a relative path, ${relative}: give absolute paths`);
	return paths;
}
