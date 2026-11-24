// pi's "Working" line while a run goes: a spinner and "Working", drawn into the editor's
// top border by pi's own `CustomEditor` (`embedWorkingStatus`), in the border's color, as
// pi draws it, without pi's "(escape to interrupt)" (Will, 2026-11-16). pi's
// `WorkingStatusIndicator` isn't exported, so this is the same on pi-tui's
// `Loader`, which it extends, with its two border methods; the editor calls only those.
//
// When Durable can't run one of the conversation's tasks, the same place says so instead,
// without a spinner: nothing is happening, and nothing will until it's ended.
import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Loader, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import { colorer } from "./colors.ts";

type Indicator = Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

class WorkingIndicator extends Loader {
	readonly kind = "working";

	/** A spinner and `message`; with `still`, a fixed mark and no timer. */
	constructor(ui: TUI, color: (text: string) => string, message = "Working", still?: { mark: string }) {
		super(
			ui,
			color,
			still === undefined ? colorer("muted") : colorer("warning"),
			message,
			still && { frames: [still.mark] },
		);
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

/** What the line says: nothing, a run going, or why the conversation is stuck. */
export type WorkingState = { kind: "idle" } | { kind: "working" } | { kind: "blocked"; message: string };

/** The working line in `editor`'s border: shown while a run goes, or while a task is blocked. */
export class WorkingLine {
	readonly #ui: TUI;
	readonly #editor: CustomEditor;
	#indicator: WorkingIndicator | undefined;
	#shownAs = "idle";

	constructor(ui: TUI, editor: CustomEditor) {
		this.#ui = ui;
		this.#editor = editor;
	}

	get shown(): boolean {
		return this.#indicator !== undefined;
	}

	/**
	 * Show it while `working`, with its spinner in the editor's border color, as pi's is; or,
	 * when blocked, the message in pi's warning color, which a blocked task wins over a run.
	 */
	update(working: boolean | WorkingState): void {
		const state: WorkingState = typeof working === "boolean" ? { kind: working ? "working" : "idle" } : working;
		const as = state.kind === "blocked" ? `blocked:${state.message}` : state.kind;
		if (as === this.#shownAs) return;
		this.#shownAs = as;
		this.#indicator?.dispose();
		this.#indicator = undefined;
		// The editor's color as it is at each frame, as it follows the thinking level.
		const border = (text: string) => this.#editor.borderColor(text);
		if (state.kind === "working") this.#indicator = new WorkingIndicator(this.#ui, border);
		if (state.kind === "blocked") {
			this.#indicator = new WorkingIndicator(this.#ui, colorer("warning"), state.message, { mark: "⚠" });
		}
		this.#editor.setWorkingStatusIndicator(this.#indicator as unknown as Indicator);
		this.#ui.requestRender();
	}
}
