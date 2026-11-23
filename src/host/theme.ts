// pi's theme in the terminal client, set up as pi sets it up: from pi's `theme`
// setting, and from the terminal's own colors, which pi's default "system" theme is
// generated from. Without them the system theme has no panel colors, so tool blocks
// lose the backgrounds that tell pending, done and failed apart.
//
// Workaround: pi's `InteractiveThemeController`, which asks the terminal for its colors
// (OSC 10, 11 and 4) and follows its light and dark switches, isn't exported (1.6.0),
// so this imports it from pi's `dist/` by path. Its module shares the theme with pi's
// public entry, as `initTheme()` keeps it on `globalThis`. An export of the controller
// (or of `setTerminalColors`) from pi's entry would replace this; not raised yet.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

interface ThemeController {
	applyFromSettings(): void;
	waitForTerminalColors(): Promise<void>;
	dispose(): void;
}

interface ThemeModules {
	InteractiveThemeController: new (
		ui: TUI,
		options: {
			getSettingsManager: () => SettingsManager;
			showError: (message: string) => void;
			onChanged: () => void;
		},
	) => ThemeController;
	stopThemeWatcher: () => void;
}

/** pi's theme modules, from the files of the pi-coding-agent pier depends on. */
async function themeModules(): Promise<ThemeModules> {
	const dist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
	const load = (file: string) => import(pathToFileURL(join(dist, "modes/interactive/theme", file)).href);
	const [controller, theme] = await Promise.all([load("theme-controller.js"), load("theme.js")]);
	return {
		InteractiveThemeController: controller.InteractiveThemeController,
		stopThemeWatcher: theme.stopThemeWatcher,
	};
}

/**
 * Apply pi's theme setting and ask the terminal for its colors, once `ui` has started.
 * Resolves when the terminal answered, or after pi's 100 ms timeout; colors that come
 * later, or a switch between light and dark, redraw the client. Returns the cleanup.
 */
export async function startTheme(
	ui: TUI,
	settings: SettingsManager,
	notify: (message: string) => void,
): Promise<() => void> {
	const { InteractiveThemeController, stopThemeWatcher } = await themeModules();
	const controller = new InteractiveThemeController(ui, {
		getSettingsManager: () => settings,
		showError: notify,
		onChanged: () => ui.requestRender(),
	});
	controller.applyFromSettings();
	await controller.waitForTerminalColors();
	return () => {
		controller.dispose();
		// A custom theme's file is watched; the watcher would keep the process alive.
		stopThemeWatcher();
	};
}
