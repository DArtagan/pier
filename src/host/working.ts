// pi's "Working" line while a run goes: a spinner and "Working (escape to interrupt)",
// drawn into the editor's top border by pi's own `CustomEditor` (`embedWorkingStatus`),
// in the border's color, as pi draws it. pi's `WorkingStatusIndicator` isn't exported in
// 1.5.2, so this is the same on pi-tui's `Loader`, which it extends, with its two
// border methods; the editor calls only those.
import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { getKeybindings, Loader, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import { colorer } from "./colors.ts";

type Indicator = Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

class WorkingIndicator extends Loader {
	readonly kind = "working";

	constructor(ui: TUI, color: (text: string) => string) {
		super(ui, color, colorer("muted"), `Working (${interruptKey()} to interrupt)`);
	}

	/** As pi's `StatusIndicator.renderInBorder`. */
	renderInBorder(width: number): string {
		const line = super.render(width + 2)[1] ?? "";
		return truncateToWidth(line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd(), width, "");
	}

	/** As pi's `StatusIndicator.renderSpinnerInBorder`. */
	renderSpinnerInBorder(width: number): string {
		return truncateToWidth(this.getRenderedIndicator(), width, "");
	}

	dispose(): void {
		this.stop();
	}
}

/** Esc, as pi names its `app.interrupt` key; pier's Esc stops the run too. */
function interruptKey(): string {
	return getKeybindings().getKeys("app.interrupt")[0] ?? "escape";
}

/** The working line in `editor`'s border: shown while a run goes, gone when it ends. */
export class WorkingLine {
	readonly #ui: TUI;
	readonly #editor: CustomEditor;
	#indicator: WorkingIndicator | undefined;

	constructor(ui: TUI, editor: CustomEditor) {
		this.#ui = ui;
		this.#editor = editor;
	}

	get shown(): boolean {
		return this.#indicator !== undefined;
	}

	/** Show it while `working`; its spinner is in the editor's border color, as pi's is. */
	update(working: boolean): void {
		if (working === this.shown) return;
		if (working) {
			// The editor's color as it is at each frame, as it follows the thinking level.
			this.#indicator = new WorkingIndicator(this.#ui, (text) => this.#editor.borderColor(text));
			this.#editor.setWorkingStatusIndicator(this.#indicator as unknown as Indicator);
		} else {
			this.#indicator?.dispose();
			this.#indicator = undefined;
			this.#editor.setWorkingStatusIndicator(undefined);
		}
		this.#ui.requestRender();
	}
}
