// pi-claude-bridge ships TypeScript source, which pi compiles at load time with jiti.
// Node won't strip types under node_modules, so load it the same way pi does.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";

/** The bridge's default export: a pi extension factory. */
export type BridgeFactory = (pi: unknown) => void;

export interface LoadedBridge {
	factory: BridgeFactory;
	/** The bridge's own transcript fold, so a prompt capture is keyed exactly as the bridge looks it up. */
	toBridgeContext: (context: Context) => Context;
	/** Where the bridge was loaded from, for reports. */
	root: string;
}

/** Load the bridge from `root` (its package directory), or from this package's dependency. */
export async function loadBridge(root?: string): Promise<LoadedBridge> {
	const dir = root ?? dirname(createRequire(import.meta.url).resolve("pi-claude-bridge/package.json"));
	const jiti = createJiti(import.meta.url, { moduleCache: true });
	const factory = await jiti.import<BridgeFactory>(join(dir, "src/index.ts"), { default: true });
	const transcript = await jiti.import<{ toBridgeContext: LoadedBridge["toBridgeContext"] }>(
		join(dir, "src/transcript.ts"),
	);
	return { factory, toBridgeContext: transcript.toBridgeContext, root: dir };
}
