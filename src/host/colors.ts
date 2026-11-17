// pi's theme colors, for pier's own text: the footer, the turn line, the editor's lines.
// pi's components take them from its theme; pier's own text should too, so it matches
// them and follows the terminal's colors (`theme.ts`). pi's `theme` isn't exported in
// 1.5.2, so this reads it from pi's `dist/` by path, as `theme.ts` reads its controller;
// it's the same instance, as `initTheme()` keeps it on `globalThis`.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

const dist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const { theme } = (await import(pathToFileURL(join(dist, "modes/interactive/theme/theme.js")).href)) as {
	theme: Theme;
};

/** `text` in pi's theme color `color`, as the theme is at the time of the call. */
export function color(name: ThemeColor, text: string): string {
	return theme.fg(name, text);
}

/** A colorer for one of pi's theme colors, for APIs that take a function. */
export function colorer(name: ThemeColor): (text: string) => string {
	return (text) => theme.fg(name, text);
}

/** The editor's border, as pi colors it: by the conversation's thinking level. */
export function editorBorder(thinkingLevel: string | undefined): (text: string) => string {
	return theme.getThinkingBorderColor((thinkingLevel ?? "off") as Parameters<Theme["getThinkingBorderColor"]>[0]);
}
