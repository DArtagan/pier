// The terminal client: a transcript (with the client's own notices in it), an editor and a footer, attached to one
// conversation in the daemon. Deliberately thin; see docs/history.md, "The thin slice".
// Fullscreen by default, on the alternate screen, as pi is; `--tui-mode regular` keeps the
// terminal's own scrollback, as pi's flag does.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Message, ModelThinkingLevel, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	CompactionSummaryMessageComponent,
	CustomEditor,
	calculateContextTokens,
	copyToClipboard,
	getMarkdownTheme,
	getSelectListTheme,
	initTheme,
	SettingsManager,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentState,
	EntryId,
	EntryRecord,
	InboxState,
	LiveState,
	TranscriptView,
} from "@earendil-works/pi-durable";
import {
	type Component,
	Container,
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
import { color, editorBorder } from "./colors.ts";
import { asPicker, commandCompletions, openArguments } from "./commands.ts";
import { Footer, footerState } from "./footer.ts";
import { type AttachTarget, DAEMON_CLOSING, type ModelSummary } from "./protocol.ts";
import { type Run, runEndingAt, runLine } from "./run-line.ts";
import { startTheme } from "./theme.ts";
import { installKeybindings, isDequeueKey, isExpandKey, isThinkingKey, ToolCalls } from "./tool-calls.ts";
import { WorkingLine } from "./working.ts";

const sgr = (open: number, close: number) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
const dim = sgr(2, 22);
const bold = sgr(1, 22);
const red = sgr(31, 39);
const yellow = sgr(33, 39);

const HELP = [
	"Enter sends; while Claude works, it steers. Alt+Enter queues a follow-up instead.",
	"Esc stops the run. Alt+Up takes queued messages back into the editor. Ctrl+C clears the editor, or detaches when it's empty.",
	"Ctrl+O expands tools' output and summaries; Ctrl+T shows or hides thinking.",
	"/ lists the commands; /model, /thinking, /resume, /fork and /tree open a menu to pick from (↑↓, Enter).",
	"/new  /earlier  /compact [instructions]",
	"/detach (leave it running)  /quit (stop it, then leave)  /exit (wait for it, then leave)",
	"Fullscreen: PageUp/PageDown scroll, Ctrl+Home/Ctrl+End go to the top/bottom, Ctrl+Up/Ctrl+Down jump",
	"between your messages, Ctrl+Shift+F searches, and a mouse selection is copied. `pier --tui-mode regular`",
	"keeps the terminal's own scrollback instead.",
].join("\n");

/** Every thinking level pi-ai has; the daemon clamps one to what the model supports. */
const THINKING_LEVELS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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
	/**
	 * pi's own settings, read only: `theme`, and `hideThinkingBlock` (start with thinking
	 * hidden; Ctrl+T toggles it). Without them, pi's defaults.
	 */
	settings?: SettingsManager;
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
	// pi's `showHardwareCursor` (or `PI_HARDWARE_CURSOR=1`): the terminal's own cursor in the
	// editor rather than a drawn one, so the terminal shows it hollow, or not at all, when
	// it isn't focused, as it does in pi. Will's is on.
	const hardwareCursor = options.settings?.getShowHardwareCursor() ?? false;
	const tui =
		options.mode === "fullscreen" ? fullscreen(terminal, hardwareCursor) : new TuiMainScreen(terminal, hardwareCursor);
	const transcript = new Container();
	// A blank line between the transcript and what's under it, as pi leaves one.
	const gap = new Spacer(1);
	const footer = new Footer(process.env.HOME);
	// The context window of the conversation's model, from the daemon, for the footer's gauge.
	let contextWindow: { model: string; tokens: number | undefined } | undefined;
	const editor = new CustomEditor(
		tui,
		{ borderColor: editorBorder(undefined), selectList: getSelectListTheme() },
		// pi's app keymap class isn't exported in 1.5.2; pi-tui's (with pier's additions,
		// `installKeybindings`) answers the same `matches` the editor asks.
		getKeybindings() as ConstructorParameters<typeof CustomEditor>[2],
		{
			embedWorkingStatus: true,
			autocompleteMaxVisible: options.settings?.getAutocompleteMaxVisible() ?? 5,
		},
	);
	asPicker(editor);
	const working = new WorkingLine(tui, editor);
	const components = [transcript, gap, editor, footer];
	for (const component of components) tui.addChild(component);
	if (tui instanceof TuiAltScreen) tui.setLayoutRoot(chatLayout(transcript, [gap], editor, [footer]));
	tui.setFocus(editor);

	const rendered = new Map<EntryId, Component>();
	const style = new TranscriptStyle(markdownTheme, new ToolCalls(tui, options.cwd), {
		hideThinking: options.settings?.getHideThinkingBlock() ?? false,
	});
	let view: TranscriptView | undefined;
	let leaving: ((code: number) => void) | undefined;
	let exitWhenIdle = false;
	// The client's own lines, in the transcript of the conversation shown (`Notice`).
	const notices: Notice[] = [];
	/** Whether the last notice is a status, which the next status replaces if nothing came between, as in pi. */
	let lastIsStatus = false;

	/**
	 * A line in the transcript, after its newest message, which scrolls away with it. A
	 * `status` (dim, passing news) replaces the status just before it, if nothing came
	 * between, as pi's `showStatus` does: `/compact` twice shows one line, not two.
	 */
	const notify = (line: string, kind: "status" | "other" = "other") => {
		const entries = view?.items.flatMap((item) => (item.kind === "entry" ? [item.entry.id] : [])) ?? [];
		const after = entries.at(-1);
		const notice: Notice = { after, component: new Text(line, 1, 1) };
		const last = notices.at(-1);
		if (kind === "status" && lastIsStatus && last?.after === after) notices[notices.length - 1] = notice;
		else notices.push(notice);
		lastIsStatus = kind === "status";
		render();
	};
	const status = (line: string) => notify(dim(line), "status");
	const live = () => (view?.docs["pi.live"] ?? {}) as LiveState;
	const busy = () => live().run !== undefined;
	const errorText = (error: unknown) => String(error instanceof Error ? error.message : error);

	/** The model's context window, asked of the daemon once per model; undefined until it answers. */
	const windowOf = (shown: TranscriptView): number | undefined => {
		const model = (shown.docs["pi.agent"] as AgentState | undefined)?.model;
		if (model === undefined) return undefined;
		const key = `${model.provider}/${model.modelId}`;
		if (contextWindow?.model !== key && client.connected) {
			contextWindow = { model: key, tokens: undefined };
			void client
				.request("model", { provider: model.provider, modelId: model.modelId })
				.then((result) => {
					if (contextWindow?.model === key) contextWindow = { model: key, tokens: result.contextWindow };
					render();
				})
				.catch(() => {
					// Asked again with the next view.
					if (contextWindow?.model === key) contextWindow = undefined;
				});
		}
		return contextWindow?.tokens;
	};
	const render = () => {
		if (view === undefined) {
			// Before the first view (the daemon refused to attach): the notices by themselves.
			transcript.clear();
			for (const notice of notices) transcript.addChild(notice.component);
			tui.requestRender();
			return;
		}
		fillTranscript(transcript, view, rendered, style, notices);
		editor.borderColor = editorBorder((view.docs["pi.agent"] as AgentState | undefined)?.thinkingLevel);
		working.update(busy() && client.connected);
		footer.update(footerState(view, windowOf(view)), statusText(conversation.number, client.connected));
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
			// Each conversation's transcript has its own notices; the last one's go with it.
			notices.length = 0;
			lastIsStatus = false;
			// The daemon sends the view before its reply, so `view` is this conversation's now.
			fillHistory(editor, userMessages());
			// The footer says which conversation; a new one, or a fork, says so at the top of
			// its transcript, which scrolls away as it grows.
			const forked = forkedFrom === undefined ? "" : `, forked from #${forkedFrom}`;
			if (created || forkedFrom !== undefined) {
				notices.push({
					after: undefined,
					component: new Text(dim(`new conversation #${conversation.number}${forked}`), 1, 0),
				});
			}
		}
		forkedFrom = undefined;
		// The view can arrive before the reply that carries the number.
		render();
	};
	/** The conversation the next attach was forked from, for its first line. */
	let forkedFrom: number | undefined;

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
				// biome-ignore lint/performance/noAwaitInLoops: a retry, each try after the last
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
			status(`reconnected to #${conversation.number}`);
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

	/** The models the daemon can run, asked once per connection. */
	let modelList: { client: PierClient; models: Promise<readonly ModelSummary[]> } | undefined;
	const models = (): Promise<readonly ModelSummary[]> => {
		if (modelList?.client !== client) {
			const asked = client.request("models", {}).then((result) => result.models);
			modelList = { client, models: asked };
			// Asked again next time.
			asked.catch(() => {
				if (modelList?.models === asked) modelList = undefined;
			});
		}
		return modelList.models;
	};
	const current = () => {
		const agent = view?.docs["pi.agent"] as AgentState | undefined;
		return {
			...(agent?.model === undefined ? {} : { model: agent.model }),
			...(agent?.thinkingLevel === undefined ? {} : { thinkingLevel: agent.thinkingLevel }),
			...(conversation.number === undefined ? {} : { number: conversation.number }),
		};
	};
	/** The user messages loaded, oldest first, for /fork. */
	const userMessages = () =>
		(view?.items ?? []).flatMap((item) => {
			if (item.kind !== "entry" || item.entry.kind !== "pi.user") return [];
			const message = item.entry.model?.[0];
			if (message?.role !== "user") return [];
			const text = typeof message.content === "string" ? message.content : textParts(message.content);
			return text.trim() === "" ? [] : [{ id: item.entry.id, text }];
		});
	editor.setAutocompleteProvider(
		commandCompletions({
			models,
			current,
			conversations: async () => (await client.request("list", { limit: 200 })).conversations,
			userMessages,
			cwd: options.cwd,
		}),
	);

	const command = async (line: string) => {
		const [name, ...rest] = line.slice(1).split(/\s+/u);
		const argument = rest.join(" ").trim();
		switch (name) {
			case "help":
				notify(dim(HELP));
				return;
			case "new":
				await attach({ kind: "new" });
				return;
			case "resume":
			case "tree": {
				if (argument === "") return pick(name);
				const number = /^#?(\d+)$/u.exec(argument)?.[1];
				if (number === undefined) {
					notify(red(`/${name} takes a conversation's number`));
					return;
				}
				return attach({ kind: "number", number: Number(number) });
			}
			case "fork": {
				if (argument === "") return pick(name);
				const message = userMessages().find((each) => String(each.id) === argument);
				if (message === undefined) {
					notify(red("/fork takes one of your messages: pick it from the menu"));
					return;
				}
				const from = conversation.number;
				const { number } = await client.request("fork", { before: message.id });
				forkedFrom = from;
				await attach({ kind: "number", number });
				// As pi's /fork does: the message forked before, to edit and send again.
				if (editor.getText() === "") editor.setText(message.text);
				return;
			}
			case "model": {
				if (argument === "") return pick(name);
				const found = (await models()).find((model) => `${model.provider}/${model.id}` === argument);
				if (found === undefined) {
					notify(red(`no model ${argument}: pick one from the menu`));
					return;
				}
				const { thinkingLevel } = await client.request("configure", {
					model: { provider: found.provider, modelId: found.id },
				});
				const before = current().thinkingLevel;
				if (thinkingLevel !== undefined && before !== undefined && thinkingLevel !== before) {
					status(`${found.id} can't think at ${before}; thinking at ${thinkingLevel}`);
				}
				return;
			}
			case "earlier":
				await conversation.loadEarlier(BACKGROUND_CONTEXT);
				return;
			case "compact":
				await client.request("compact", argument === "" ? {} : { instructions: argument });
				status("compacting in the background");
				return;
			case "thinking": {
				if (argument === "") return pick(name);
				if (!THINKING_LEVELS.includes(argument as ModelThinkingLevel)) {
					notify(red(`no thinking level ${argument}: pick one from the menu`));
					return;
				}
				const { thinkingLevel } = await client.request("configure", {
					thinkingLevel: argument as ModelThinkingLevel,
				});
				if (thinkingLevel !== undefined && thinkingLevel !== argument) {
					status(`this model can't think at ${argument}; thinking at ${thinkingLevel}`);
				}
				return;
			}
			case "detach":
				leaving?.(0);
				return;
			case "quit":
				if (busy()) await client.request("abort", {});
				leaving?.(0);
				return;
			case "exit":
				exitWhenIdle = true;
				if (busy()) status("leaving once the run ends; Ctrl+C leaves now");
				else leaving?.(0);
				return;
			default:
				notify(red(`unknown command /${name}; /help lists them`));
		}
	};

	/**
	 * Take back the queued messages into the editor, before what's typed there, as pi's
	 * Alt+Up does: to edit them and send them again.
	 */
	const dequeue = async () => {
		// Silent, either way: the editor filling up, or not, says what happened.
		const { texts } = await client.request("dequeue", {});
		if (texts.length === 0) return;
		editor.setText([...texts, editor.getText()].filter((text) => text.trim() !== "").join("\n\n"));
		// The daemon's answer comes after the key's frame: draw what it brought now.
		tui.requestRender();
	};

	/** Open `/name`'s menu, for its argument to be picked. */
	const pick = (name: string) => {
		editor.setText(`/${name} `);
		openArguments(editor);
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
				// `setText` doesn't redraw; without this the text stays until the next key.
				tui.requestRender();
				void submit(text, "followUp");
			}
			return { consume: true };
		}
		if (isDequeueKey(data)) {
			void dequeue().catch((error: unknown) => notify(red(errorText(error))));
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
			if (editor.getText() === "") leaving?.(0);
			else {
				editor.setText("");
				tui.requestRender();
			}
			return { consume: true };
		}
		return;
	});

	const done = new Promise<number>((resolve) => {
		leaving = resolve;
	});
	tui.start();
	// As pi does once its TUI has started: the terminal answers with its colors, which
	// pi's system theme is made from, within 100 ms.
	const stopTheme = await startTheme(tui, options.settings ?? SettingsManager.inMemory(), (message) =>
		notify(red(message)),
	);
	try {
		await attach(options.target);
		watchConnection(client);
	} catch (error) {
		notify(red(errorText(error)));
		leaving?.(1);
	}
	const code = await done;
	left.abort();
	// Stops the clocks of calls still running, and the spinner, which would keep the process alive.
	style.clear();
	working.update(false);
	stopTheme();
	if (tui instanceof TuiAltScreen) leaveFullscreen(tui, components);
	else tui.stop();
	client.close();
	return code;
}

/** The alternate screen, set up as pi's `createInteractiveTui` sets it up (not exported in 1.5.2). */
/**
 * Fill the editor's Up-arrow history with a conversation's messages, oldest first, as pi
 * does when it opens a session (`populateHistory`), replacing the last conversation's.
 * pi-tui's editor keeps it in a private array, which only `addToHistory` adds to.
 */
export function fillHistory(editor: CustomEditor, messages: readonly { text: string }[]): void {
	const held = editor as unknown as { history?: string[] };
	if (Array.isArray(held.history)) held.history.length = 0;
	for (const message of messages) editor.addToHistory(message.text);
}

function fullscreen(terminal: Terminal, hardwareCursor: boolean): TuiAltScreen {
	const bottom = getKeybindings().getKeys("tui.altScreen.bottom")[0];
	const shortcut = bottom === undefined ? "" : ` · ${bottom.replace(/(^|\+)([a-z])/gu, (all) => all.toUpperCase())}`;
	return new TuiAltScreen(terminal, hardwareCursor, undefined, {
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
 * The transcript scrolling above a dock that keeps the editor and the footer
 * in view, as pi's `createChatViewport` lays them out (not exported in 1.5.2).
 */
export function chatLayout(
	transcript: Component,
	above: readonly Component[],
	editor: Component,
	below: readonly Component[] = [],
): Component {
	const scrolling = new ScrollView(transcript, {
		follow: "end",
		primary: true,
		overscroll: "chain",
		scrollbar: "auto",
	});
	const dock = new VStack([
		...above.map((component) => ({ component, shrink: 1, minSize: 0 })),
		{ component: editor, shrink: 1, minSize: 3 },
		...below.map((component) => ({ component, shrink: 1, minSize: 0 })),
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
	readonly #responses = new Set<AssistantMessageComponent>();
	readonly #summaries = new Set<CompactionSummaryMessageComponent>();
	/** The model response still streaming: one component, updated as it grows, as pi's is. */
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
		for (const response of this.#responses) response.setHideThinkingBlock(hide);
		this.#streaming?.setHideThinkingBlock(hide);
	}

	/** A stored model response, as pi draws it. */
	response(message: AssistantMessage): AssistantMessageComponent {
		const component = new AssistantMessageComponent(message, this.#hideThinking, this.markdown);
		this.#responses.add(component);
		return component;
	}

	/** The streaming response's component, updated to `message`; a new one once a stored response took the last's place. */
	streaming(message: AssistantMessage): AssistantMessageComponent {
		if (this.#streaming === undefined) {
			this.#streaming = new AssistantMessageComponent(undefined, this.#hideThinking, this.markdown);
		}
		this.#streaming.updateContent(message, true);
		return this.#streaming;
	}

	/** The response stopped streaming: the next one gets a new component. */
	streamEnded(): void {
		this.#streaming = undefined;
	}

	/**
	 * A compaction's summary, as pi draws it. `tokensBefore` is the context it summarized,
	 * which Durable doesn't record: pi takes it from the last model response's usage
	 * before the compaction, as `fillTranscript` does.
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
		this.#responses.clear();
		this.#summaries.clear();
		this.#streaming = undefined;
	}
}

/**
 * A line of the client's own in the transcript ("compacting in the background", an error),
 * after the entry that was newest when it appeared, so it scrolls away with the rest.
 */
export interface Notice {
	/** The newest entry shown when it appeared; undefined before any. */
	readonly after: EntryId | undefined;
	readonly component: Component;
}

/**
 * Fill `transcript` with `view`'s entries and live state, reusing the components in
 * `rendered` for entries drawn before: entries never change once stored. `notices` go
 * after the entries they came after, in the order they came, and before what's live.
 */
export function fillTranscript(
	transcript: Container,
	view: TranscriptView,
	rendered: Map<EntryId, Component>,
	style: TranscriptStyle,
	notices: readonly Notice[] = [],
): void {
	transcript.clear();
	// Entries come in id order, and notices in the order they came: before each entry go
	// the notices that appeared before it existed.
	let next = 0;
	const noticesBefore = (id: EntryId | undefined) => {
		for (; next < notices.length; next++) {
			const notice = notices[next] as Notice;
			if (id !== undefined && notice.after !== undefined && notice.after >= id) return;
			transcript.addChild(notice.component);
		}
	};
	const { tools } = style;
	const live = (view.docs["pi.live"] ?? {}) as LiveState;
	// The context the last model response so far was sent with: what a compaction after it summarized.
	let context: number | undefined;
	// The loaded entries, in order, for the run line after each run's final answer.
	const entries = view.items.flatMap((item) => (item.kind === "entry" ? [item.entry] : []));
	let at = -1;
	for (const item of view.items) {
		if (item.kind === "entry") at++;
		if (item.kind === "entry") {
			const message = item.entry.model?.[0];
			// As pi's `getAssistantUsage`: failed responses, and ones without usage, don't count.
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
			noticesBefore(item.entry.id);
			let component = rendered.get(item.entry.id);
			if (component === undefined) {
				component = renderEntry(item.entry, style, context);
				// A run's final answer gets the run's line, once the run is all loaded; it never changes after.
				const run = runEndingAt(entries, at);
				if (run !== undefined) component = withRunLine(component, run);
				rendered.set(item.entry.id, component);
			}
			transcript.addChild(component);
		}
	}
	// Those after the newest entry, before what's live (the streaming response, what's queued).
	noticesBefore(undefined);
	tools.follow(live);
	for (const component of renderLive(live, view.docs["pi.inbox"] as InboxState | undefined, style)) {
		transcript.addChild(component);
	}
}

function renderEntry(entry: EntryRecord, style: TranscriptStyle, context: number | undefined): Component {
	const { tools } = style;
	const message = entry.model?.[0];
	if (entry.kind === "pi.compaction") {
		// pi's component says how many tokens were summarized; without a response before it to tell, a plain rule.
		if (context === undefined) return new Text(dim("── earlier messages were summarized ──"), 1, 1);
		return withSpace(style.summary(compactionSummary(message), context));
	}
	if (entry.kind === "pi.reset") return new Text(dim("── a new context starts here ──"), 1, 1);
	if (message === undefined || message.role === "system") return new Container();
	if (message.role === "user") {
		const text = typeof message.content === "string" ? message.content : textParts(message.content);
		return withSpace(new UserMessageComponent(text, style.markdown));
	}
	if (message.role === "assistant") return renderResponse(message, style, true);
	// A tool result settles its call's component, which draws it. One whose call isn't
	// loaded (`/earlier` brought the result's page, not the response's) draws itself until it is.
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
 * A model response as pi draws it (`AssistantMessageComponent`: Markdown, thinking shown
 * or hidden, its error), followed by its tool calls (`ToolCalls`): one turn, in Durable's
 * terms. `stored` is false for the response still streaming.
 */
function renderResponse(message: AssistantMessage, style: TranscriptStyle, stored: boolean): Component {
	const { tools } = style;
	const container = new Container();
	container.addChild(stored ? style.response(message) : style.streaming(message));
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

/** `component`, then its run's line, dim, as cachemire draws its own: `◍ run: 3 turns · 3s · …`. */
function withRunLine(component: Component, run: Run): Component {
	const container = new Container();
	container.addChild(component);
	container.addChild(new Spacer(1));
	container.addChild(new Text(color("dim", `◍ ${runLine(run)}`), 1, 0));
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
	const match = /<summary>\n?([\s\S]*?)\n?<\/summary>\s*$/u.exec(text);
	return (match?.[1] ?? text).trim();
}

function renderLive(live: LiveState, inbox: InboxState | undefined, style: TranscriptStyle): Component[] {
	const { tools } = style;
	const components: Component[] = [];
	const partial = live.generation?.message as AssistantMessage | undefined;
	if (partial === undefined) style.streamEnded();
	else components.push(renderResponse(partial, style, false));
	if (live.generation?.retry !== undefined) {
		components.push(new Text(yellow(`retrying: ${live.generation.retry.error}`), 1, 0));
	}
	for (const slot of live.tools ?? []) {
		// Its call's component shows it, under the response that made the call.
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

/** The footer's first words: what the client is doing, and which conversation. */
function statusText(number: number | undefined, connected: boolean): string {
	// A run going shows as pi's working line in the editor's border, not here.
	const conversation = `#${number ?? "?"}`;
	return connected ? conversation : `${yellow("reconnecting…")} · ${conversation}`;
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
