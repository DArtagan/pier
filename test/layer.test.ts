// pier's layer (src/layer/) is what carries over to p3: it may use pi's and Durable's
// packages, but nothing of pier's host (src/host/), which is thrown away when p3 takes
// over. See docs/vision.md.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const layer = join(root, "src", "layer");

/** Every module specifier a TypeScript file imports or re-exports, statically or dynamically. */
function specifiers(source: string): string[] {
	const found: string[] = [];
	for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) found.push(match[1] ?? "");
	return found;
}

describe("the layer", () => {
	const files = readdirSync(layer).filter((name) => name.endsWith(".ts"));

	it("has files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)("%s imports nothing of the host", (name) => {
		const path = join(layer, name);
		const outside = specifiers(readFileSync(path, "utf8"))
			.filter((specifier) => specifier.startsWith("."))
			.map((specifier) => relative(root, resolve(dirname(path), specifier)))
			.filter((target) => !target.startsWith(join("src", "layer")));
		expect(outside).toEqual([]);
	});

	it("catches an import of the host", () => {
		const reach = specifiers(
			'import { startDaemon } from "../host/daemon.ts";\nconst x = await import("../host/tui.ts");',
		);
		expect(reach).toEqual(["../host/daemon.ts", "../host/tui.ts"]);
	});
});
