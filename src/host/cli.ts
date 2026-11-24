#!/usr/bin/env node
// pier: the daemon, and the terminal client that attaches to it.
//   pier                 continue the newest conversation in this directory, or start one
//   pier new             start a new conversation here
//   pier resume <n>      attach to conversation #<n>
//   pier list [--all]    conversations here (or everywhere), newest first
//   pier daemon          run the daemon in the foreground
// The client runs fullscreen; `--tui-mode regular` keeps the terminal's scrollback, as in pi.
// The socket is $PIER_SOCKET, or $XDG_RUNTIME_DIR/pier/pier.sock. The daemon offers the
// skills under $PIER_SKILLS (`:`-separated) beside each project's own.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { loadClaudeCodeProvider } from "../layer/claude-code.ts";
import { createPrompt } from "../layer/prompt.ts";
import { createSkills } from "../layer/skills.ts";
import { PierClient } from "./client.ts";
import { activity } from "./commands.ts";
import { startDaemon } from "./daemon.ts";
import { defaultModel, defaultThinkingLevel } from "./defaults.ts";
import { skillPaths, socketPath, stateDir } from "./paths.ts";
import type { AttachTarget } from "./protocol.ts";
import { runTui, type TuiMode, takeTuiMode } from "./tui.ts";

const USAGE = "usage: pier [--tui-mode fullscreen|regular] [new | resume <number> | list [--all] | daemon]";

async function main(argv: string[]): Promise<number> {
	const taken = takeTuiMode(argv);
	if ("error" in taken) {
		console.error(`pier: ${taken.error}\n${USAGE}`);
		return 2;
	}
	const [command, ...rest] = taken.rest;
	const attach = (target: AttachTarget) => attachTui(target, taken.mode);
	switch (command) {
		case undefined:
			return attach({ kind: "continue" });
		case "new":
			return attach({ kind: "new" });
		case "resume": {
			const number = Number(rest[0]?.replace(/^#/u, ""));
			if (!Number.isInteger(number) || number < 1) {
				console.error(USAGE);
				return 2;
			}
			return attach({ kind: "number", number });
		}
		case "list":
			return list(rest.includes("--all"));
		case "daemon":
			return daemon();
		case "-h":
		case "--help":
			console.log(USAGE);
			return 0;
		default:
			console.error(USAGE);
			return 2;
	}
}

async function attachTui(target: AttachTarget, mode: TuiMode): Promise<number> {
	// pi's own settings, read only: its theme, and whether thinking starts hidden.
	const settings = SettingsManager.create(process.cwd());
	return runTui({
		mode,
		settings,
		socketPath: await reachable(),
		target,
		cwd: process.cwd(),
		env: environment(),
	});
}

async function list(all: boolean): Promise<number> {
	const client = await PierClient.connect(await reachable());
	try {
		const { conversations } = await client.request("list", all ? {} : { cwd: process.cwd() });
		for (const summary of conversations) {
			const where = all ? `  ${summary.cwd ?? ""}` : "";
			const state = activity(summary);
			console.log(
				`#${summary.number}${state === undefined ? "" : ` (${state})`}  ${summary.title ?? "(empty)"}${where}`,
			);
		}
		return 0;
	} finally {
		client.close();
	}
}

/** The socket, if a daemon answers on it. */
async function reachable(): Promise<string> {
	const path = socketPath();
	try {
		(await PierClient.connect(path)).close();
		return path;
	} catch (error) {
		throw new Error(`No pier daemon on ${path}: start one with \`pier daemon\``, { cause: error });
	}
}

/** This process's environment, as the tools of the conversation will see it. */
function environment(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

async function daemon(): Promise<number> {
	const log = (message: string) => console.error(`${new Date().toISOString()} ${message}`);
	// Read first, so a mistake in either stops the daemon before it does anything.
	const model = defaultModel();
	const thinkingLevel = defaultThinkingLevel();
	const state = stateDir();
	const skills = skillPaths();
	await mkdir(state, { recursive: true, mode: 0o700 });
	// pi-claude-code runs Claude Code in the conversation's directory (ConversationDirectories),
	// and in this process's otherwise, telling the model about it, git status included. The
	// state directory says nothing about any project.
	process.chdir(state);
	const models = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
	models.registerNativeProvider(await loadClaudeCodeProvider());
	const running = await startDaemon({
		socketPath: socketPath(),
		storage: await openNodeSqliteStorage(join(state, "pier.sqlite")),
		models,
		model,
		thinkingLevel,
		extensions: [createPrompt(), createSkills({ paths: skills })],
		log,
	});
	log(`storage ${join(state, "pier.sqlite")}`);
	log(`skills ${skills.length === 0 ? "(none beyond projects')" : skills.join(" ")}`);
	const stop = () => void running.close();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	await running.closed;
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error: unknown) => {
		console.error(`pier: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	},
);
