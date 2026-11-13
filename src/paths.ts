// Where the daemon keeps its socket and its storage.
import { homedir } from "node:os";
import { join } from "node:path";

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
