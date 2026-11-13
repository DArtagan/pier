#!/usr/bin/env node
// pier: the daemon, and the terminal client that attaches to it.
//   pier                 continue the newest conversation in this directory, or start one
//   pier new             start a new conversation here
//   pier resume <n>      attach to conversation #<n>
//   pier list [--all]    conversations here (or everywhere), newest first
//   pier daemon          run the daemon in the foreground
// The socket is $PIER_SOCKET, or $XDG_RUNTIME_DIR/pier/pier.sock.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { PierClient } from "./client.ts";
import { startDaemon } from "./daemon.ts";
import { socketPath, stateDir } from "./paths.ts";
import { CLAUDE_CODE_PROVIDER, loadClaudeCodeProvider } from "./providers/claude-code.ts";
import { runTui } from "./tui.ts";

const USAGE = `usage: pier [new | resume <number> | list [--all] | daemon]`;

async function main(args: string[]): Promise<number> {
	const [command, ...rest] = args;
	switch (command) {
		case undefined:
			return attach({ kind: "continue" });
		case "new":
			return attach({ kind: "new" });
		case "resume": {
			const number = Number(rest[0]?.replace(/^#/, ""));
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

async function attach(target: Parameters<typeof runTui>[0]["target"]): Promise<number> {
	return runTui({ socketPath: await reachable(), target, cwd: process.cwd(), env: environment() });
}

async function list(all: boolean): Promise<number> {
	const client = await PierClient.connect(await reachable());
	try {
		const { conversations } = await client.request("list", all ? {} : { cwd: process.cwd() });
		for (const summary of conversations) {
			const where = all ? `  ${summary.cwd ?? ""}` : "";
			console.log(`#${summary.number}${summary.busy ? " (working)" : ""}  ${summary.title ?? "(empty)"}${where}`);
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
	} catch {
		throw new Error(`No pier daemon on ${path}: start one with \`pier daemon\``);
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
	const state = stateDir();
	await mkdir(state, { recursive: true, mode: 0o700 });
	// pi-claude-code runs Claude Code in this process's directory, and Claude Code tells
	// the model about it (git status included). The state directory says nothing about any
	// project; the conversation's own directory is in pier's prompt.
	process.chdir(state);
	const models = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
	models.registerNativeProvider(await loadClaudeCodeProvider());
	// PIER_MODEL is `provider/model`; Claude through Claude Code by default.
	const [provider, ...model] = (process.env.PIER_MODEL ?? `${CLAUDE_CODE_PROVIDER}/claude-opus-5-5`).split("/");
	const running = await startDaemon({
		socketPath: socketPath(),
		storage: await openNodeSqliteStorage(join(state, "pier.sqlite")),
		models,
		model: { provider: provider ?? CLAUDE_CODE_PROVIDER, modelId: model.join("/") },
		thinkingLevel: (process.env.PIER_THINKING ?? "high") as ModelThinkingLevel,
		log,
	});
	log(`storage ${join(state, "pier.sqlite")}`);
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
