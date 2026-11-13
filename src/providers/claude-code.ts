// Earendil's Claude Code provider (@earendil-works/pi-claude-code): requests go through
// `claude -p` on Claude Code's own login, and pi runs the tools. It's a plain pi-ai
// provider, so it needs no shim on Durable. It ships TypeScript, which Node won't strip
// under node_modules, so it's loaded with jiti, as pi loads it.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";

/** Its provider id: models are `claude-code/<model>`. */
export const CLAUDE_CODE_PROVIDER = "claude-code";

/**
 * The provider, ready for `ModelRuntime.registerNativeProvider()`. It runs the Claude
 * Code named by `PI_CLAUDE_CODE_COMMAND` (default `claude` on the PATH).
 */
export async function loadClaudeCodeProvider(): Promise<Provider> {
	const dir = dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-claude-code/package.json"));
	const jiti = createJiti(import.meta.url, { moduleCache: true });
	const { createClaudeCodeProvider } = await jiti.import<{ createClaudeCodeProvider: () => Provider }>(
		join(dir, "src/provider.ts"),
	);
	return createClaudeCodeProvider();
}
