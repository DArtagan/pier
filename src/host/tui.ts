// The terminal client: a transcript, a status line and an editor, attached to one
// conversation in the daemon. Deliberately thin; see docs/history.md, "The thin slice".
// Fullscreen by default, on the alternate screen, as pi is; `--tui-mode regular` keeps the
// terminal's own scrollback, as pi's flag does.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	CompactionSummaryMessageComponent,
	calculateContextTokens,
	copyToClipboard,
	getMarkdownTheme,
	getSelectListTheme,
	initTheme,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentState,
	EntryId,
	EntryRecord,
	InboxState,
	LiveState,
	TranscriptView,
	UsageState,
} from "@earendil-works/pi-durable";
import {
	type Component,
	Container,
	Editor,
	getKeybindings,
	type MarkdownTheme,
	matchesKey,
	ProcessTerminal,
	ScrollView,
	Spacer,
	type Terminal,
	Text,
	TuiAltScreen,
	TuiMainScreen,
	VStack,
} from "@earendil-works/pi-tui";
import { AttachedConversation, connectWhenUp, DaemonError, PierClient } from "./client.ts";
import { type AttachTarget, type ConversationSummary, DAEMON_CLOSING } from "./protocol.ts";
import { installKeybindings, isExpandKey, isThinkingKey, ToolCalls } from "./tool-calls.ts";

const sgr = (open: number, close: number) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
const dim = sgr(2, 22);
const bold = sgr(1, 22);
const red = sgr(31, 39);
const yellow = sgr(33, 39);

const HELP = [
	"Enter sends; while Claude works, it steers. Alt+Enter queues a follow-up instead.",
	"Esc stops the run. Ctrl+C clears the editor, or detaches when it's empty.",
	"Ctrl+O expands tools' output and summaries; Ctrl+T shows or hides thinking.",
	"/new  /resume [all | <number>]  /earlier  /compact [instructions]  /thinking <level>",
	"/detach (leave it running)  /quit (stop it, then leave)  /exit (wait for it, then leave)",
	"Fullscreen: PageUp/PageDown scroll, Ctrl+Home/Ctrl+End go to the top/bottom, Ctrl+Up/Ctrl+Down jump",
	"between your messages, Ctrl+Shift+F searches, and a mouse selection is copied. `pier --tui-mode regular`",
	"keeps the terminal's own scrollback instead.",
].join("\n");

/** pi's `tuiMode`: the alternate screen, with its own scrolling and search, or the terminal's own scrollback. */
export type TuiMode = "fullscreen" | "regular";

/**
 * Take pi's `--tui-mode <fullscreen | regular>` out of `args`, as pi parses it. Returns
 * the mode (fullscreen if absent) and the rest of the arguments, or an error.
 */
export function takeTuiMode(args: readonly string[]): { mode: TuiMode; rest: string[] } | { error: string } {
	let mode: TuiMode = "fullscreen";
	const rest: string[] = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] !== "--tui-mode") {
			rest.push(args[index] as string);
			continue;
		}
		const value = args[++index];
		if (value !== "fullscreen" && value !== "regular") return { error: "--tui-mode requires regular or fullscreen" };
		mode = value;
	}
	return { mode, rest };
}

export interface TuiOptions {
	mode: TuiMode;
	/** pi's `hideThinkingBlock`: start with thinking hidden; Ctrl+T toggles it. */
	hideThinking?: boolean;
	socketPath: string;
	target: AttachTarget;
	cwd: string;
	env: Record<string, string>;
}

/** Run the client until the user leaves; resolves with the exit code. */
export async function runTui(options: TuiOptions): Promise<number> {
	// Replaced when the connection drops and comes back (`reconnect`, below).
	let client = await PierClient.connect(options.socketPath);
	const conversation = new AttachedConversation(client);
	// Aborted when the user leaves, which stops reconnecting.
	const left = new AbortController();
	initTheme();
	installKeybindings();
	const markdownTheme = getMarkdownTheme();

	const terminal = new ProcessTerminal();
	const tui = options.mode === "fullscreen" ? fullscreen(terminal) : new TuiMainScreen(terminal);
	const transcript = new Container();
	const notices = new Text("", 1, 0);
	const status = new Text("", 1, 0);
	const editor = new Editor(tui, { borderColor: dim, selectList: getSelectListTheme() });
	const components = [transcript, notices, status, editor];
	for (const component of components) tui.addChild(component);
	if (tui instanceof TuiAltScreen) tui.setLayoutRoot(chatLayout(transcript, [notices, status], editor));
	tui.setFocus(editor);

	const rendered = new Map<EntryId, Component>();
	const style = new TranscriptStyle(markdownTheme, new ToolCalls(tui, options.cwd), {
		hideThinking: options.hideThinking ?? false,
	});
	let view: TranscriptView | undefined;
	let leaving: ((code: number) => void) | undefined;
	let exitWhenIdle = false;
	const noticeLines: string[] = [];

	const notify = (line: string) => {
		noticeLines.push(...line.split("\n"));
		notices.setText(noticeLines.slice(-8).join("\n"));
		tui.requestRender();
	};
	const live = () => (view?.docs["pi.live"] ?? {}) as LiveState;
	const busy = () => live().run !== undefined;
	const errorText = (error: unknown) => String(error instanceof Error ? error.message : error);

	const render = () => {
		if (view === undefined) return;
		fillTranscript(transcript, view, rendered, style);
		status.setText(statusLine(view, conversation.number, client.connected));
		tui.requestRender();
		if (exitWhenIdle && !busy()) leaving?.(0);
	};
	// A gap opens when the daemon's window moved on without this client (a long outage, or a
	// client too slow for it): load what's missing at once. A fill the connection cut short
	// starts again with the view reconnecting brings.
	let filling = false;
	const fillGaps = () => {
		if (filling || !client.connected || !view?.items.some((item) => item.kind === "gap")) return;
		filling = true;
		void conversation
			.fillGaps(BACKGROUND_CONTEXT)
			.catch((error: unknown) => {
				if (client.connected) notify(red(`can't load the missed messages: ${errorText(error)}`));
			})
			.finally(() => {
				filling = false;
			});
	};
	conversation.subscribe((next) => {
		view = next;
		render();
		fillGaps();
	});

	const attach = async (target: AttachTarget) => {
		const before = conversation.id;
		// Cleared only once it worked, so a failed /resume leaves the transcript as it was.
		const { created } = await conversation.attach(target, options.cwd, options.env);
		// Entry ids are unique across conversations, so this only frees the old one's.
		if (conversation.id !== before) {
			rendered.clear();
			style.clear();
		}
		// The view can arrive before the reply that carries the number.
		render();
		notify(dim(`${created ? "new conversation" : "conversation"} #${conversation.number} in ${options.cwd}`));
	};

	const submit = async (text: string, whenBusy: "steer" | "followUp") => {
		if (!client.connected) {
			// Keep it for when the daemon is back, unless something else was typed since.
			if (editor.getText() === "") editor.setText(text);
			notify(yellow("not connected to the daemon yet; send it again once it's back"));
			return;
		}
		try {
			await client.request("submit", { text, whenBusy });
		} catch (error) {
			notify(red(errorText(error)));
		}
	};

	/**
	 * The connection dropped (the daemon restarted), or the daemon stopped sending the view:
	 * connect again and resume the transcript where it left off. Gives up only when the
	 * daemon refuses, as one of another protocol version does after an upgrade.
	 */
	let recovering = false;
	const recover = (why: string) => {
		if (left.signal.aborted || recovering) return;
		recovering = true;
		void (async () => {
			notify(yellow(`${why}; reconnecting… Ctrl+C leaves`));
			render();
			for (;;) {
				const next = client.connected ? client : await connectWhenUp(options.socketPath, { signal: left.signal });
				try {
					await conversation.reattach(next, options.cwd, options.env);
					client = next;
					break;
				} catch (error) {
					// The daemon refused it (the conversation is gone): reconnecting won't help.
					if (error instanceof DaemonError) throw error;
					// Dropped again mid-attach, as when the daemon was still closing.
					next.close();
				}
			}
			watchConnection(client);
			notify(dim(`reconnected to #${conversation.number}`));
			render();
			// The view can arrive before `client` is the new connection, which `fillGaps` waits for.
			fillGaps();
		})()
			.catch((error: unknown) => {
				if (left.signal.aborted) return;
				notify(red(`can't reconnect: ${errorText(error)}`));
				leaving?.(1);
			})
			.finally(() => {
				recovering = false;
			});
	};
	const watchConnection = (watched: PierClient) => {
		void watched.closed.then(() => {
			if (watched === client) recover("lost the daemon");
		});
		watched.onEvent((event) => {
			// "the daemon is closing" is followed by the connection closing, which `closed` sees.
			if (watched === client && event.event === "ended" && event.reason !== DAEMON_CLOSING) {
				recover(`the view stopped (${event.reason})`);
			}
		});
	};

	const command = async (line: string) => {
		const [name, ...rest] = line.slice(1).split(/\s+/);
		const argument = rest.join(" ").trim();
		switch (name) {
			case "help":
				notify(dim(HELP));
				return;
			case "new":
				await attach({ kind: "new" });
				return;
			case "resume": {
				const number = /^#?(\d+)$/.exec(argument)?.[1];
				if (number !== undefined) return attach({ kind: "number", number: Number(number) });
				if (argument !== "" && argument !== "all") {
					notify(red("/resume takes a conversation's number, or all"));
					return;
				}
				const { conversations } = await client.request("list", {
					...(argument === "all" ? {} : { cwd: options.cwd }),
					limit: 20,
				});
				notify(
					conversations.length === 0
						? dim("no conversations here; /resume all lists every directory")
						: conversations.map((summary) => summaryLine(summary, argument === "all")).join("\n") +
								dim("\n/resume <number> opens one"),
				);
				return;
			}
			case "earlier":
				await conversation.loadEarlier(BACKGROUND_CONTEXT);
				return;
			case "compact":
				await client.request("compact", argument === "" ? {} : { instructions: argument });
				notify(dim("compacting in the background"));
				return;
			case "thinking":
				await client.request("configure", { thinkingLevel: argument as never });
				return;
			case "detach":
				leaving?.(0);
				return;
			case "quit":
				if (busy()) await client.request("abort", {});
				leaving?.(0);
				return;
			case "exit":
				exitWhenIdle = true;
				if (busy()) notify(dim("leaving once the run ends; Ctrl+C leaves now"));
				else leaving?.(0);
				return;
			default:
				notify(red(`unknown command /${name}; /help lists them`));
		}
	};

	editor.onSubmit = (text) => {
		const trimmed = text.trim();
		if (trimmed === "") return;
		editor.addToHistory(trimmed);
		editor.setText("");
		const action = trimmed.startsWith("/") ? command(trimmed) : submit(trimmed, "steer");
		void action.catch((error: unknown) => notify(red(errorText(error))));
	};
	tui.addInputListener((data) => {
		if (matchesKey(data, "alt+enter") || matchesKey(data, "ctrl+shift+enter")) {
			const text = editor.getText().trim();
			if (text !== "") {
				editor.addToHistory(text);
				editor.setText("");
				void submit(text, "followUp");
			}
			return { consume: true };
		}
		if (isExpandKey(data)) {
			style.setExpanded(!style.expanded);
			tui.requestRender();
			return { consume: true };
		}
		if (isThinkingKey(data)) {
			style.setHideThinking(!style.hideThinking);
			tui.requestRender();
			return { consume: true };
		}
		if (matchesKey(data, "escape") && busy()) {
			void client.request("abort", {}).catch(() => {});
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d")) {
			if (editor.getText() !== "") editor.setText("");
			else leaving?.(0);
			return { consume: true };
		}
		return undefined;
	});

	const done = new Promise<number>((resolve) => {
		leaving = resolve;
	});
	tui.start();
	try {
		await attach(options.target);
		watchConnection(client);
		notify(dim("/help lists the keys and commands"));
	} catch (error) {
		notify(red(errorText(error)));
		leaving?.(1);
	}
	const code = await done;
	left.abort();
	// Stops the clocks of calls still running, which would keep the process alive.
	style.clear();
	if (tui instanceof TuiAltScreen) leaveFullscreen(tui, components);
	else tui.stop();
	client.close();
	return code;
}

/** The alternate screen, set up as pi's `createInteractiveTui` sets it up (not exported in 1.5.2). */
function fullscreen(terminal: Terminal): TuiAltScreen {
	const bottom = getKeybindings().getKeys("tui.altScreen.bottom")[0];
	const shortcut = bottom === undefined ? "" : ` · ${bottom.replace(/(^|\+)([a-z])/g, (all) => all.toUpperCase())}`;
	return new TuiAltScreen(terminal, undefined, undefined, {
		scrollToEndIndicator: () => `\x1b[7m ↓ Jump to latest message${shortcut} \x1b[27m`,
		wheelScrollLines: "auto",
		copySelection: async (text) => {
			try {
				await copyToClipboard(text);
				return true;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		},
	});
}

/**
 * The transcript scrolling above a dock that keeps the status and the editor in view, as
 * pi's `createChatViewport` lays them out (not exported in 1.5.2).
 */
export function chatLayout(transcript: Component, above: readonly Component[], editor: Component): Component {
	const scrolling = new ScrollView(transcript, {
		follow: "end",
		primary: true,
		overscroll: "chain",
		scrollbar: "auto",
	});
	const dock = new VStack([
		...above.map((component) => ({ component, shrink: 1, minSize: 0 })),
		{ component: editor, shrink: 1, minSize: 3 },
	]);
	return new VStack([
		{ component: scrolling, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]);
}

/**
 * Leave the alternate screen, and print the transcript into the terminal's scrollback, as
 * pi does by default (`fullscreenExitOutput: "transcript"`): it hands the same components
 * to a main-screen renderer, draws them once, and stops it.
 */
function leaveFullscreen(tui: TuiAltScreen, components: readonly Component[]): void {
	tui.stop({ preserveScreen: true });
	tui.setFocus(null);
	tui.clear();
	tui.setLayoutRoot(undefined);
	const main = new TuiMainScreen(tui.terminal);
	for (const component of components) main.addChild(component);
	main.invalidate();
	main.renderNow();
	main.stop();
}

/**
 * How the transcript draws, shared by every entry: pi's Markdown theme, the tool calls'
 * components, and pi's two toggles, Ctrl+O (tools' output and summaries) and Ctrl+T
 * (thinking). One per conversation shown.
 */
export class TranscriptStyle {
	readonly markdown: MarkdownTheme;
	readonly tools: ToolCalls;
	readonly #answers = new Set<AssistantMessageComponent>();
	readonly #summaries = new Set<CompactionSummaryMessageComponent>();
	/** The answer still streaming: one component, updated as it grows, as pi's is. */
	#streaming: AssistantMessageComponent | undefined;
	#hideThinking: boolean;

	constructor(markdown: MarkdownTheme, tools: ToolCalls, options: { hideThinking?: boolean } = {}) {
		this.markdown = markdown;
		this.tools = tools;
		this.#hideThinking = options.hideThinking ?? false;
	}

	get expanded(): boolean {
		return this.tools.expanded;
	}

	get hideThinking(): boolean {
		return this.#hideThinking;
	}

	/** Expand or collapse tools' output and summaries, as Ctrl+O does in pi. */
	setExpanded(expanded: boolean): void {
		this.tools.setExpanded(expanded);
		for (const summary of this.#summaries) summary.setExpanded(expanded);
	}

	/** Show or hide thinking, as Ctrl+T does in pi. */
	setHideThinking(hide: boolean): void {
		this.#hideThinking = hide;
		for (const answer of this.#answers) answer.setHideThinkingBlock(hide);
		this.#streaming?.setHideThinkingBlock(hide);
	}

	answer(message: AssistantMessage): AssistantMessageComponent {
		const component = new AssistantMessageComponent(message, this.#hideThinking, this.markdown);
		this.#answers.add(component);
		return component;
	}

	/** The streaming answer's component, updated to `message`; a new one once a stored answer took the last's place. */
	streaming(message: AssistantMessage): AssistantMessageComponent {
		if (this.#streaming === undefined) {
			this.#streaming = new AssistantMessageComponent(undefined, this.#hideThinking, this.markdown);
		}
		this.#streaming.updateContent(message, true);
		return this.#streaming;
	}

	/** The answer stopped streaming: the next one gets a new component. */
	streamEnded(): void {
		this.#streaming = undefined;
	}

	/**
	 * A compaction's summary, as pi draws it. `tokensBefore` is the context it summarized,
	 * which Durable doesn't record: pi takes it from the last answer's usage before the
	 * compaction, as `fillTranscript` does.
	 */
	summary(text: string, tokensBefore: number): CompactionSummaryMessageComponent {
		const component = new CompactionSummaryMessageComponent(
			{ role: "compactionSummary", summary: text, tokensBefore, timestamp: 0 },
			this.markdown,
		);
		component.setExpanded(this.expanded);
		this.#summaries.add(component);
		return component;
	}

	/** Forget every component, as when the client shows another conversation. */
	clear(): void {
		this.tools.clear();
		this.#answers.clear();
		this.#summaries.clear();
		this.#streaming = undefined;
	}
}

/**
 * Fill `transcript` with `view`'s entries and live state, reusing the components in
 * `rendered` for entries drawn before: entries never change once stored.
 */
export function fillTranscript(
	transcript: Container,
	view: TranscriptView,
	rendered: Map<EntryId, Component>,
	style: TranscriptStyle,
): void {
	transcript.clear();
	const { tools } = style;
	const live = (view.docs["pi.live"] ?? {}) as LiveState;
	// The context the last answer so far was sent with: what a compaction after it summarized.
	let context: number | undefined;
	for (const item of view.items) {
		if (item.kind === "entry") {
			const message = item.entry.model?.[0];
			// As pi's `getAssistantUsage`: failed answers, and ones without usage, don't count.
			if (
				message?.role === "assistant" &&
				message.usage !== undefined &&
				message.stopReason !== "error" &&
				message.stopReason !== "aborted"
			) {
				const tokens = calculateContextTokens(message.usage);
				if (tokens > 0) context = tokens;
			}
		}
		if (item.kind === "earlier") transcript.addChild(new Text(dim("… earlier messages: /earlier loads them"), 1, 0));
		else if (item.kind === "gap") transcript.addChild(new Text(dim("… loading the messages missed"), 1, 0));
		else {
			let component = rendered.get(item.entry.id);
			if (component === undefined) {
				component = renderEntry(item.entry, style, context);
				rendered.set(item.entry.id, component);
			}
			transcript.addChild(component);
		}
	}
	tools.follow(live);
	for (const component of renderLive(live, view.docs["pi.inbox"] as InboxState | undefined, style)) {
		transcript.addChild(component);
	}
}

function renderEntry(entry: EntryRecord, style: TranscriptStyle, context: number | undefined): Component {
	const { tools } = style;
	const message = entry.model?.[0];
	if (entry.kind === "pi.compaction") {
		// pi's component says how many tokens were summarized; without an answer before it to tell, a plain rule.
		if (context === undefined) return new Text(dim("── earlier messages were summarized ──"), 1, 1);
		return withSpace(style.summary(compactionSummary(message), context));
	}
	if (entry.kind === "pi.reset") return new Text(dim("── a new context starts here ──"), 1, 1);
	if (message === undefined || message.role === "system") return new Container();
	if (message.role === "user") {
		const text = typeof message.content === "string" ? message.content : textParts(message.content);
		return withSpace(new UserMessageComponent(text, style.markdown));
	}
	if (message.role === "assistant") return renderAssistant(message, style, true);
	// A tool result settles its call's component, which draws it. One whose call isn't
	// loaded (`/earlier` brought the result's page, not the answer's) draws itself until it is.
	if (tools.result(message)) return new Container();
	return new OrphanResult(message.toolCallId, tools, toolResultText(message));
}

/** A tool result whose call isn't loaded: its last lines, until the call's component draws it. */
class OrphanResult implements Component {
	readonly #callId: string;
	readonly #tools: ToolCalls;
	readonly #text: Text;

	constructor(callId: string, tools: ToolCalls, text: Text) {
		this.#callId = callId;
		this.#tools = tools;
		this.#text = text;
	}

	render(width: number): string[] {
		return this.#tools.has(this.#callId) ? [] : this.#text.render(width);
	}

	invalidate(): void {
		this.#text.invalidate();
	}
}

function toolResultText(message: ToolResultMessage): Text {
	const output = textParts(message.content).trimEnd();
	const lines = output.split("\n");
	const shown = lines.slice(-8).join("\n");
	const more = lines.length > 8 ? dim(`  … ${lines.length - 8} more lines\n`) : "";
	return new Text(`${more}${(message.isError ? red : dim)(indent(shown || "(no output)"))}`, 1, 0);
}

/**
 * An answer as pi draws it (`AssistantMessageComponent`: Markdown, thinking shown or
 * hidden, its error), followed by its tool calls (`ToolCalls`). `stored` is false for the
 * answer still streaming.
 */
function renderAssistant(message: AssistantMessage, style: TranscriptStyle, stored: boolean): Component {
	const { tools } = style;
	const container = new Container();
	container.addChild(stored ? style.answer(message) : style.streaming(message));
	for (const part of message.content) {
		if (part.type !== "toolCall") continue;
		const component = tools.call(part, stored);
		if (component !== undefined) container.addChild(component);
		if (stored && (message.stopReason === "error" || message.stopReason === "aborted")) {
			tools.failed(part, message.stopReason === "aborted" ? "Operation aborted" : message.errorMessage || "Error");
		}
	}
	return container;
}

/** pi's components start with no blank line of their own; pi's chat puts a spacer before each. */
function withSpace(component: Component): Component {
	const container = new Container();
	container.addChild(new Spacer(1));
	container.addChild(component);
	return container;
}

/** The summary in a compaction entry, without the wrapping Durable gives it for the model. */
export function compactionSummary(message: Message | undefined): string {
	if (message === undefined || message.role !== "user") return "";
	const text = typeof message.content === "string" ? message.content : textParts(message.content);
	const match = /<summary>\n?([\s\S]*?)\n?<\/summary>\s*$/.exec(text);
	return (match?.[1] ?? text).trim();
}

function renderLive(live: LiveState, inbox: InboxState | undefined, style: TranscriptStyle): Component[] {
	const { tools } = style;
	const components: Component[] = [];
	const partial = live.generation?.message as AssistantMessage | undefined;
	if (partial !== undefined) components.push(renderAssistant(partial, style, false));
	else style.streamEnded();
	if (live.generation?.retry !== undefined) {
		components.push(new Text(yellow(`retrying: ${live.generation.retry.error}`), 1, 0));
	}
	for (const slot of live.tools ?? []) {
		// Its call's component shows it, under the answer that made the call.
		if (slot.status === "done" || tools.has(slot.callId)) continue;
		const tail = (slot.output ?? "").trimEnd().split("\n").slice(-6).join("\n");
		components.push(
			new Text(
				`${slot.status === "running" ? yellow("●") : dim("○")} ${bold(slot.name)}${tail ? `\n${dim(indent(tail))}` : ""}`,
				1,
				0,
			),
		);
	}
	if (live.compactions !== undefined) components.push(new Text(dim("summarizing earlier messages…"), 1, 0));
	if (live.run === undefined && live.runFailure !== undefined) {
		const { reason, detail } = live.runFailure;
		components.push(
			new Text(red(`the run ended without an answer: ${reason}${detail ? ` (${String(detail)})` : ""}`), 1, 1),
		);
	}
	for (const item of inbox?.items ?? []) {
		const text = "content" in item && typeof item.content === "string" ? item.content : "";
		if (text !== "") components.push(new Text(dim(`queued: ${text}`), 1, 0));
	}
	return components;
}

/** One conversation in a listing: its number, title, and where. */
export function summaryLine(summary: ConversationSummary, withDirectory: boolean): string {
	const where = withDirectory && summary.cwd !== undefined ? `  ${summary.cwd}` : "";
	return `${bold(`#${summary.number}`)}  ${summary.title ?? dim("(empty)")}${dim(`${summary.busy ? "  working" : ""}${where}`)}`;
}

function statusLine(view: TranscriptView, number: number | undefined, connected: boolean): string {
	const agent = (view.docs["pi.agent"] ?? {}) as AgentState;
	const usage = (view.docs["pi.usage"] ?? { models: {} }) as UsageState;
	let tokens = 0;
	for (const entry of Object.values(usage.models ?? {}))
		tokens += entry.input + entry.output + entry.cacheRead + entry.cacheWrite;
	const working = (view.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
	const model = agent.model ? `${agent.model.provider}/${agent.model.modelId}` : "default model";
	return dim(
		[
			!connected ? yellow("reconnecting…") : working ? yellow("working… Esc stops") : "ready",
			model,
			`thinking ${agent.thinkingLevel ?? "default"}`,
			`${Math.round(tokens / 1000)}k tokens`,
			`#${number ?? "?"}`,
			agent.cwd ?? "",
		].join(" · "),
	);
}

function textParts(content: readonly { type: string; text?: string }[] | string): string {
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`)).join("");
}

function indent(text: string): string {
	return text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}
