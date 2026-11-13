// Earendil's Claude Code provider (@earendil-works/pi-claude-code): requests go through
// `claude -p` on Claude Code's own login, and pi runs the tools. It's a plain pi-ai
// provider, so it needs no shim on Durable. It ships TypeScript, which Node won't strip
// under node_modules, so it's loaded with jiti, as pi loads it.
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Context as ChordContext } from "@earendil-works/chord/context";
import type { Provider, SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	CompactionTask,
	defineExtension,
	type Extension,
	GenerationTask,
	type HookApi,
	hook,
	ProviderDoc,
} from "@earendil-works/pi-durable";
import { createJiti } from "jiti";

/** Its provider id: models are `claude-code/<model>`. */
export const CLAUDE_CODE_PROVIDER = "claude-code";

/**
 * The provider, ready for `ModelRuntime.registerNativeProvider()`. It runs the Claude
 * Code named by `PI_CLAUDE_CODE_COMMAND` (default `claude` on the PATH), in the
 * directory of the conversation each request is for, which `ConversationDirectories`
 * records: install it in the Harness too.
 */
export async function loadClaudeCodeProvider(): Promise<Provider> {
	const dir = dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-claude-code/package.json"));
	const jiti = createJiti(import.meta.url, { moduleCache: true });
	const { createClaudeCodeProvider } = await jiti.import<{ createClaudeCodeProvider: () => Provider }>(
		join(dir, "src/provider.ts"),
	);
	return inConversationDirectories(createClaudeCodeProvider());
}

// Claude Code tells the model its working directory, as the "primary working directory"
// of its environment block, and pi-claude-code starts it in `process.cwd()`. That's right
// in pi, one session per process, and wrong in a daemon that serves conversations in many
// directories: Claude saw the daemon's directory and the conversation's disagree. Nothing
// in a pi-ai request carries a directory, so pier remembers each conversation's, by its
// provider session id, and runs each request in a scope where `process.cwd()` answers it.
// Outside those scopes it answers as always. A provider option for this, upstream, would
// replace all of it.

/** Provider session id -> the conversation's directory. */
const directories = new Map<string, string>();
const scope = new AsyncLocalStorage<string>();
let cwdScoped = false;

function scopeCwd(): void {
	if (cwdScoped) return;
	cwdScoped = true;
	const real = process.cwd.bind(process);
	process.cwd = () => scope.getStore() ?? real();
}

/** `provider`, with each request run in its conversation's directory. Exported for the tests. */
export function inConversationDirectories(provider: Provider): Provider {
	scopeCwd();
	const within = <T>(options: SimpleStreamOptions | undefined, run: () => T): T => {
		const directory = options?.sessionId === undefined ? undefined : directories.get(options.sessionId);
		return directory === undefined ? run() : scope.run(directory, run);
	};
	return new Proxy(provider, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key, target);
			if (typeof value !== "function") return value;
			if (key === "stream" || key === "streamSimple") {
				return (...args: unknown[]) =>
					within(args[2] as SimpleStreamOptions | undefined, () => value.apply(target, args));
			}
			return value.bind(target);
		},
	});
}

/** Record the directory of the conversation a request is for, before the request. */
async function remember(api: HookApi, context: ChordContext): Promise<undefined> {
	const provider = await api.snapshot(ProviderDoc, api.conversationId, context);
	const agent = await api.snapshot(AgentDoc, api.conversationId, context);
	if (provider !== undefined && agent?.cwd !== undefined) directories.set(provider.sessionId, agent.cwd);
	return undefined;
}

/** Tells the provider each conversation's directory. Install it wherever pi-claude-code runs. */
export const ConversationDirectories: Extension = defineExtension({
	name: "pier.conversation-directories",
	hooks: [
		hook(GenerationTask, { beforeRequest: (_request, api, context) => remember(api, context) }),
		// A summary can be a conversation's first request in this process.
		hook(CompactionTask, { beforeCompact: (_compaction, api, context) => remember(api, context) }),
	],
});
