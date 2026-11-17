// Tool calls in the terminal client, drawn by pi's own `ToolExecutionComponent` with the
// renderers of pi's tool definitions, as p2 draws Durable's tools (its
// `plugins/coding-tools/cards.ts` copies the same renderers). Durable's tools aren't
// pi's, but their arguments are, and an edit's result carries the `details.diff` pi's
// edit renderer draws.
//
// One component per call, as in pi: the stored answer places it, the running slot
// updates it, and the stored result settles it. A component that started running has a
// timer ticking ("Elapsed 3s") until it gets a final result, so a call that never gets
// one (its task faulted, or the view moved on) is settled by `settle()`, and every
// component by `clear()`.
import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import type { LiveState } from "@earendil-works/pi-durable";
import {
	type Component,
	getKeybindings,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";

type ToolResult = Parameters<ToolExecutionComponent["updateResult"]>[0];
type Definition = ConstructorParameters<typeof ToolExecutionComponent>[4];
type Ui = ConstructorParameters<typeof ToolExecutionComponent>[5];

/** pi's binding for showing tools' whole output, which pi's renderers name in their hints. */
export const EXPAND_TOOLS = "app.tools.expand";
/** pi's binding for showing and hiding thinking. */
export const TOGGLE_THINKING = "app.thinking.toggle";

/**
 * pi-tui's keybindings, plus the three of pi's that pier's screen names, with pi's keys: Ctrl+O,
 * Ctrl+T and Esc. pi's own app keymap (`KEYBINDINGS`) isn't exported in 1.5.2; without these,
 * pi's components' hints ("… more lines, ctrl+o to expand") name no key.
 */
export function installKeybindings(): void {
	setKeybindings(
		new KeybindingsManager({
			...TUI_KEYBINDINGS,
			[EXPAND_TOOLS]: { defaultKeys: "ctrl+o", description: "Toggle tool output" },
			[TOGGLE_THINKING]: { defaultKeys: "ctrl+t", description: "Toggle thinking blocks" },
			// What pi's working line names as the key that stops a run; pier's Esc does that.
			"app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" },
		}),
	);
}

/** Whether `data` is the key that expands and collapses tools' output. */
export function isExpandKey(data: string): boolean {
	return getKeybindings().matches(data, EXPAND_TOOLS);
}

/** Whether `data` is the key that shows and hides thinking. */
export function isThinkingKey(data: string): boolean {
	return getKeybindings().matches(data, TOGGLE_THINKING);
}

interface Call {
	readonly component: ToolExecutionComponent;
	/** Whether a stored answer placed it; until then, a streaming answer draws it. */
	placed: boolean;
	started: boolean;
	/** The running output last shown, and whether the call has its final result. */
	output: string | undefined;
	settled: boolean;
}

export class ToolCalls {
	readonly #calls = new Map<string, Call>();
	/** Results stored before their call was loaded, as `/earlier` can bring them. */
	readonly #results = new Map<string, ToolResult>();
	readonly #definitions: Record<string, Definition>;
	readonly #ui: Ui;
	readonly #cwd: string;
	#expanded = false;

	constructor(ui: Ui, cwd: string) {
		this.#ui = ui;
		this.#cwd = cwd;
		this.#definitions = {
			read: createReadToolDefinition(cwd),
			write: createWriteToolDefinition(cwd),
			edit: createEditToolDefinition(cwd),
			bash: createBashToolDefinition(cwd),
		};
	}

	get expanded(): boolean {
		return this.#expanded;
	}

	/** Show every call's whole output, or collapse it, as Ctrl+O does in pi. */
	setExpanded(expanded: boolean): void {
		this.#expanded = expanded;
		for (const call of this.#calls.values()) call.component.setExpanded(expanded);
	}

	/**
	 * The component of `toolCall`. `placed` is true from a stored answer, false from a
	 * streaming one, whose arguments may still grow; `undefined` when a stored answer
	 * placed it already (a streaming answer and its stored entry can show together).
	 */
	call(toolCall: ToolCall, placed: boolean): Component | undefined {
		let call = this.#calls.get(toolCall.id);
		if (call === undefined) {
			const component = new ToolExecutionComponent(
				toolCall.name,
				toolCall.id,
				toolCall.arguments,
				{},
				this.#definitions[toolCall.name],
				this.#ui,
				this.#cwd,
			);
			component.setExpanded(this.#expanded);
			call = { component, placed, started: false, output: undefined, settled: false };
			this.#calls.set(toolCall.id, call);
			const result = this.#results.get(toolCall.id);
			if (result !== undefined) this.#settle(call, result);
			return component;
		}
		if (!placed) {
			if (call.placed) return undefined;
			call.component.updateArgs(toolCall.arguments);
			return call.component;
		}
		// Not `setArgsComplete()`: for an edit, pi's renderer would then read the file to
		// preview a diff the stored result already carries (p2 drops that preview too).
		if (!call.placed) call.component.updateArgs(toolCall.arguments);
		call.placed = true;
		return call.component;
	}

	/** An answer that ended in error or was aborted: its calls never ran. */
	failed(toolCall: ToolCall, message: string): void {
		const call = this.#calls.get(toolCall.id);
		if (call !== undefined && !call.settled) {
			this.#settle(call, { content: [{ type: "text", text: message }], isError: true });
		}
	}

	/**
	 * A stored result: settles its call. Returns whether the call is held; if not, the
	 * caller draws the result itself until the call is loaded.
	 */
	result(message: ToolResultMessage): boolean {
		const result: ToolResult = {
			content: message.content,
			details: message.details,
			isError: message.isError,
			...(typeof message.durationMs === "number" ? { durationMs: message.durationMs } : {}),
		};
		this.#results.set(message.toolCallId, result);
		const call = this.#calls.get(message.toolCallId);
		if (call === undefined) return false;
		this.#settle(call, result);
		return true;
	}

	/** Whether `callId`'s call is held, so an orphan result can stop drawing itself. */
	has(callId: string): boolean {
		return this.#calls.get(callId)?.placed === true;
	}

	/**
	 * Follow the running slots of `live`, and settle every call that started and has no
	 * running slot left without getting its result: its timer would tick for good.
	 */
	follow(live: LiveState): void {
		const running = new Set<string>();
		for (const slot of live.tools ?? []) {
			const call = this.#calls.get(slot.callId);
			if (call === undefined || call.settled || slot.status === "done") continue;
			running.add(slot.callId);
			if (slot.status !== "running") continue;
			if (!call.started) {
				call.started = true;
				call.component.markExecutionStarted();
			}
			if (slot.output !== undefined && slot.output !== call.output) {
				call.output = slot.output;
				call.component.updateResult(
					{ content: [{ type: "text", text: slot.output }], details: slot.details, isError: false },
					true,
				);
			}
		}
		for (const [id, call] of this.#calls) {
			if (call.started && !call.settled && !running.has(id)) this.#stop(call);
		}
	}

	/** Settle every call, and forget them all, as when the client shows another conversation. */
	clear(): void {
		for (const call of this.#calls.values()) if (!call.settled) this.#stop(call);
		this.#calls.clear();
		this.#results.clear();
	}

	/** How many calls are still running, as far as the components know (for tests). */
	get running(): number {
		let count = 0;
		for (const call of this.#calls.values()) if (call.started && !call.settled) count++;
		return count;
	}

	#settle(call: Call, result: ToolResult): void {
		call.settled = true;
		call.component.updateResult(result, false);
	}

	/** Stop a call's clock with what it showed last; its stored result, if one comes, replaces it. */
	#stop(call: Call): void {
		this.#settle(call, { content: [{ type: "text", text: call.output ?? "" }], isError: false });
	}
}
