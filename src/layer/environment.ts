// The environment contract: what a conversation's tool calls run with. Every variable a
// command gets is one of the contract's, and nothing else, not the daemon's process and
// not the pane that attached: an allowlist, never a denylist. Later sources win:
//
//   base       the user's login shell, read once, filtered to BASE_VARIABLES
//   project    direnv's export in the working directory (its `.env` included, as is)
//   settings   pier's configuration (`tools.variables`)
//   identity   PIER=1, and PIER_CONVERSATION
//
// Delivered through bash's `prepare` hook: each call's `env` is the contract's variables,
// with `inheritEnv: false`. Not through NodeExecutionEnv's `shellEnv`, which
// `inheritEnv: false` drops too (Durable 1.6.0, `env/node.ts`, `getShellEnv`). `read`,
// `write` and `edit` take no environment. Variables aren't a boundary: a tool still runs
// as the user, and can reach what the user can by path.
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { inflateSync } from "node:zlib";
import type { Context } from "@earendil-works/chord/context";
import {
	type ConversationId,
	type DocumentReader,
	defineExtension,
	type Extension,
	section,
} from "@earendil-works/pi-durable";
import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-durable/tools";

/** The login shell's variables a tool gets; one the shell doesn't set is left out. */
export const BASE_VARIABLES: readonly (string | RegExp)[] = [
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"PATH",
	"LANG",
	/^LC_[A-Z]+$/u,
	"TZ",
	"TZDIR",
	"TMPDIR",
	"LOCALE_ARCHIVE",
	"NIX_PATH",
	"NIX_PROFILES",
	"NIX_USER_PROFILE_DIR",
	"TERMINFO_DIRS",
	"XDG_DATA_DIRS",
	"XDG_CONFIG_DIRS",
	"XDG_RUNTIME_DIR",
];

const MARKER = "\0pier-login-environment\0";

/** The user's login shell, by absolute path: an empty environment has no PATH to find one with. */
export function loginShell(): string {
	const user = userInfo();
	// getent reads NSS (LDAP and the like too); where there's none (macOS), the passwd entry Node reads.
	const getent = spawnSync("getent", ["passwd", user.username], { encoding: "utf8" });
	const shell = getent.status === 0 ? getent.stdout.trim().split(":")[6] : undefined;
	return shell || user.shell || "/bin/sh";
}

/**
 * The whole environment of the user's login shell, started from nothing but HOME and
 * USER, as a new terminal would get it: the system's and the user's profiles, without
 * a desktop's or a pane's variables. Throws if the shell fails.
 */
export async function probeLoginEnvironment(shell = loginShell(), timeoutMs = 30_000): Promise<Record<string, string>> {
	const user = userInfo();
	// The marker sets the environment apart from anything a profile prints.
	const { status, stdout, stderr } = await run(shell, ["-lc", `printf '${MARKER.replaceAll("\0", "\\0")}'; env -0`], {
		cwd: user.homedir,
		env: { HOME: user.homedir, USER: user.username },
		timeoutMs,
	});
	const at = stdout.indexOf(MARKER);
	if (status !== 0 || at < 0) {
		throw new Error(`The login shell ${shell} didn't give its environment (exit ${status}): ${stderr.trim()}`);
	}
	return parseEnv0(stdout.slice(at + MARKER.length));
}

function parseEnv0(text: string): Record<string, string> {
	const variables: Record<string, string> = {};
	for (const line of text.split("\0")) {
		const equals = line.indexOf("=");
		if (equals > 0) variables[line.slice(0, equals)] = line.slice(equals + 1);
	}
	return variables;
}

/** `login`'s variables that are on the list, and TERM=dumb: there's no terminal. */
export function baseVariables(
	login: Readonly<Record<string, string>>,
	list: readonly (string | RegExp)[] = BASE_VARIABLES,
): Record<string, string> {
	const kept = Object.entries(login).filter(([name]) =>
		list.some((entry) => (typeof entry === "string" ? entry === name : entry.test(name))),
	);
	return { ...Object.fromEntries(kept), TERM: "dumb" };
}

/** Where a directory's project environment stands. */
export type ProjectStatus =
	/** Evaluated; `variables` holds it. */
	| "ready"
	/** No `.envrc` here or above, or no direnv: nothing to add. */
	| "none"
	/** Being evaluated, for the first time or after a change. */
	| "pending"
	/** An `.envrc` that hasn't been allowed (`direnv allow`). */
	| "blocked"
	/** direnv failed; `error` says how. */
	| "failed";

export interface ProjectEnvironment {
	readonly status: ProjectStatus;
	/** What the project sets, over the login environment: a name with `null` is unset. */
	readonly variables: Readonly<Record<string, string | null>>;
	readonly error?: string;
}

interface Watch {
	readonly path: string;
	readonly modtime: number;
	readonly exists: boolean;
}

interface Entry {
	current?: ProjectEnvironment & { watches: readonly Watch[] };
	evaluating?: Promise<void>;
}

/**
 * The first executable `name` on any of `paths` (PATH-style lists), in order: so the login
 * shell's PATH first, then the daemon's own. Undefined if none has it.
 */
export function findExecutable(name: string, paths: readonly (string | undefined)[]): string | undefined {
	for (const list of paths) {
		for (const dir of (list ?? "").split(delimiter)) {
			if (dir === "") continue;
			const candidate = join(dir, name);
			try {
				accessSync(candidate, constants.X_OK);
				if (statSync(candidate).isFile()) return candidate;
			} catch {
				// Not here.
			}
		}
	}
	return undefined;
}

export interface ProjectEnvironmentsOptions {
	/** The whole login environment: direnv reports a difference against what it's given. */
	login: Readonly<Record<string, string>>;
	/** direnv, by path. Default the first on the login shell's PATH, else on the daemon's own. */
	direnv?: string;
	log?: (message: string) => void;
	/** How long one evaluation may take. Default ten minutes: a changed devenv.nix may build. */
	timeoutMs?: number;
}

/**
 * Each directory's project environment, from `direnv export json` run there with the
 * whole login environment, as a shell entering the directory would get it. Evaluated in
 * the background and cached; evaluated again when a file direnv watches changes
 * (`DIRENV_WATCHES`: the `.envrc`, devenv's files, direnv's allow list). Only an allowed
 * `.envrc` runs: direnv's own trust gate. Without direnv, no project has an environment.
 */
export class ProjectEnvironments {
	readonly #entries = new Map<string, Entry>();
	readonly #options: ProjectEnvironmentsOptions;
	/** direnv, by path; undefined when there's none. */
	readonly direnv: string | undefined;

	constructor(options: ProjectEnvironmentsOptions) {
		this.#options = options;
		this.direnv = options.direnv ?? findExecutable("direnv", [options.login.PATH, process.env.PATH]);
	}

	/**
	 * Where `dir`'s environment stands now, starting an evaluation if it needs one: the
	 * last evaluation's, while a new one runs after a change, or `pending` before the first.
	 */
	peek(dir: string): ProjectEnvironment {
		const current = this.#refresh(dir).current;
		return current === undefined ? { status: "pending", variables: {} } : strip(current);
	}

	/**
	 * `dir`'s environment, waiting up to `waitMs` for an evaluation under way. One that
	 * takes longer is left running, and this answers with what's known: the environment
	 * from before a change, or `pending`, with no variables.
	 */
	async get(dir: string, waitMs: number): Promise<ProjectEnvironment> {
		const entry = this.#refresh(dir);
		if (entry.evaluating !== undefined) {
			let timer: NodeJS.Timeout | undefined;
			const waited = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, waitMs);
			});
			await Promise.race([entry.evaluating, waited]);
			clearTimeout(timer);
		}
		return this.peek(dir);
	}

	#refresh(dir: string): Entry {
		let entry = this.#entries.get(dir);
		if (entry === undefined) {
			entry = {};
			this.#entries.set(dir, entry);
		}
		if (entry.evaluating === undefined && !fresh(entry.current)) {
			const evaluating = this.#evaluate(dir, entry).finally(() => {
				if (entry.evaluating === evaluating) delete entry.evaluating;
			});
			entry.evaluating = evaluating;
		}
		return entry;
	}

	async #evaluate(dir: string, entry: Entry): Promise<void> {
		const log = this.#options.log ?? (() => {});
		const started = performance.now();
		if (this.direnv === undefined) {
			entry.current = { status: "none", variables: {}, watches: [] };
			return;
		}
		const result = await run(this.direnv, ["export", "json"], {
			cwd: dir,
			// Without the variables of a direnv already loaded, so direnv starts afresh.
			env: Object.fromEntries(Object.entries(this.#options.login).filter(([name]) => !name.startsWith("DIRENV_"))),
			timeoutMs: this.#options.timeoutMs ?? 10 * 60_000,
		});
		const ms = Math.round(performance.now() - started);
		let exported: Record<string, string | null> = {};
		try {
			if (result.stdout.trim() !== "") exported = JSON.parse(result.stdout) as Record<string, string | null>;
		} catch {
			// Reported below, as a failure.
		}
		const watches = decodeWatches(exported.DIRENV_WATCHES);
		const variables = Object.fromEntries(Object.entries(exported).filter(([name]) => !name.startsWith("DIRENV_")));
		let next: ProjectEnvironment;
		if (result.spawnError !== undefined) {
			next = { status: "none", variables: {}, error: result.spawnError };
		} else if (/ is blocked\b/u.test(result.stderr)) {
			next = { status: "blocked", variables: {} };
		} else if (result.status !== 0) {
			next = { status: "failed", variables: {}, error: lastLines(result.stderr) || `exit ${result.status}` };
		} else if (exported.DIRENV_FILE === undefined && Object.keys(variables).length === 0) {
			next = { status: "none", variables: {} };
		} else {
			next = { status: "ready", variables };
		}
		// Nothing to watch (no .envrc, no direnv): looked at again on the next call, which is cheap.
		entry.current = { ...next, watches };
		if (next.status !== "none") {
			const count = next.status === "ready" ? `, ${Object.keys(variables).length} variables` : "";
			const why = next.error === undefined ? "" : `: ${next.error}`;
			log(`project environment of ${dir}: ${next.status}${count}, ${ms} ms${why}`);
		}
	}
}

function strip(current: ProjectEnvironment & { watches: readonly Watch[] }): ProjectEnvironment {
	const { watches: _watches, ...environment } = current;
	return environment;
}

/** Whether nothing direnv watches has changed since `current` was evaluated. */
function fresh(current: { status: ProjectStatus; watches: readonly Watch[] } | undefined): boolean {
	if (current === undefined || current.watches.length === 0) return false;
	return current.watches.every((watch) => {
		try {
			const stat = statSync(watch.path);
			return watch.exists && Math.floor(stat.mtimeMs / 1000) === watch.modtime;
		} catch {
			return !watch.exists;
		}
	});
}

/** direnv's `DIRENV_WATCHES`: zlib-compressed JSON, in URL-safe base64. */
function decodeWatches(value: string | null | undefined): Watch[] {
	if (!value) return [];
	try {
		return JSON.parse(inflateSync(Buffer.from(value, "base64url")).toString("utf8")) as Watch[];
	} catch {
		return [];
	}
}

function lastLines(text: string): string {
	return text.trim().split("\n").slice(-3).join(" / ");
}

interface Ran {
	status: number | null;
	stdout: string;
	stderr: string;
	spawnError?: string;
}

function run(
	command: string,
	args: readonly string[],
	options: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<Ran> {
	return new Promise((resolve) => {
		// `env.PATH` is where `command` is looked for.
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: options.timeoutMs,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
		child.once("error", (error) => resolve({ status: null, stdout, stderr, spawnError: error.message }));
		child.once("close", (status) => resolve({ status, stdout, stderr }));
	});
}

/** `variables` with `changes` applied: a name with `null` is removed. */
function apply(variables: Record<string, string>, changes: Readonly<Record<string, string | null>>): void {
	for (const [name, value] of Object.entries(changes)) {
		if (value === null) delete variables[name];
		else variables[name] = value;
	}
}

export interface EnvironmentOptions {
	/** The login shell's whole environment (`probeLoginEnvironment`); the base is filtered from it. */
	login: Readonly<Record<string, string>>;
	/** Agent settings, laid over the base and the project's: pier's `tools.variables`. */
	settings?: Readonly<Record<string, string>>;
	/** The conversation's name for PIER_CONVERSATION, such as `thenixbeast#3`; none leaves it out. */
	name?: (conversationId: ConversationId, read: DocumentReader, context: Context) => Promise<string | undefined>;
	/** How long a call waits for a project's environment being evaluated. Default 60 s. */
	projectWaitMs?: number;
	/** A bash call's timeout in seconds when the model gives none. Default none. */
	timeoutSeconds?: number;
	log?: (message: string) => void;
	/** Shared with other users of the same login, to evaluate each directory once. */
	projects?: ProjectEnvironments;
}

/** The contract, assembled for each call. */
export class ToolEnvironment {
	readonly base: Readonly<Record<string, string>>;
	readonly projects: ProjectEnvironments;
	readonly #options: EnvironmentOptions;

	constructor(options: EnvironmentOptions) {
		this.#options = options;
		this.base = baseVariables(options.login);
		this.projects =
			options.projects ??
			new ProjectEnvironments({ login: options.login, ...(options.log === undefined ? {} : { log: options.log }) });
	}

	/** Every variable a call in `cwd` for `conversationId` gets. */
	async variables(
		cwd: string,
		conversationId: ConversationId,
		read: DocumentReader,
		context: Context,
	): Promise<Record<string, string>> {
		const variables = { ...this.base };
		const project = await this.projects.get(cwd, this.#options.projectWaitMs ?? 60_000);
		apply(variables, project.variables);
		Object.assign(variables, this.#options.settings ?? {});
		variables.PIER = "1";
		const name = await this.#options.name?.(conversationId, read, context);
		if (name === undefined) delete variables.PIER_CONVERSATION;
		else variables.PIER_CONVERSATION = name;
		return variables;
	}

	/**
	 * The coding tools, `read`, `write`, `edit` and `bash`, as Durable's `CodingTools` and
	 * under its name, with bash's calls run under the contract. Install it in place of
	 * `CodingTools`, and `section()` with the prompt's.
	 */
	tools(): Extension {
		const bash = createBashTool({
			prepare: async (execution, api, context) => {
				execution.env = await this.variables(execution.cwd, api.conversationId, api, context);
				execution.inheritEnv = false;
			},
		});
		const timeout = this.#options.timeoutSeconds;
		const tools = [createReadTool(), createWriteTool(), createEditTool(), bash].map((tool) =>
			tool !== bash || timeout === undefined
				? tool
				: {
						...bash,
						execute: (args: Parameters<typeof bash.execute>[0], ...rest: DropFirst<Parameters<typeof bash.execute>>) =>
							bash.execute({ ...args, timeout: args.timeout ?? timeout }, ...rest),
					},
		);
		return defineExtension({ name: "coding-tools", tools });
	}

	/** A prompt section saying when the project's environment isn't there: pending, not allowed, or failed. */
	section(): Extension {
		return defineExtension({
			name: "pier.environment",
			sections: [section("project_environment", (input) => this.#describe(input.agent.cwd))],
		});
	}

	/**
	 * What the model should know of its project's environment, when it isn't simply there.
	 * Waits a little for one being evaluated, so a warm project doesn't flash "pending".
	 */
	async #describe(cwd: string | undefined): Promise<string | undefined> {
		if (cwd === undefined) return undefined;
		const project = await this.projects.get(cwd, 3_000);
		switch (project.status) {
			case "ready":
			case "none":
				return undefined;
			case "pending":
				return "The project's environment (direnv) is still being prepared. Until it's ready, commands may run without the project's toolchain on PATH.";
			case "blocked":
				return "This project's .envrc hasn't been allowed (`direnv allow`), so commands run without the project's environment. Don't allow it yourself: ask the user.";
			case "failed":
				return `The project's environment (direnv) failed to load, so commands run without it: ${project.error ?? "unknown error"}`;
		}
	}
}

type DropFirst<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest] ? Rest : never;
