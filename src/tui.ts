// The terminal client: a transcript, a status line and an editor, attached to one
// conversation in the daemon. Deliberately thin; see todos/poc.md, "The thin slice".
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getMarkdownTheme, getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
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
	Markdown,
	type MarkdownTheme,
	matchesKey,
	ProcessTerminal,
	Text,
	TuiMainScreen,
} from "@earendil-works/pi-tui";
import { AttachedConversation, PierClient } from "./client.ts";
import type { AttachTarget, ConversationSummary } from "./protocol.ts";

const sgr = (open: number, close: number) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;
const dim = sgr(2, 22);
const bold = sgr(1, 22);
const red = sgr(31, 39);
const green = sgr(32, 39);
const yellow = sgr(33, 39);
const cyan = sgr(36, 39);

const HELP = [
	"Enter sends; while Claude works, it steers. Alt+Enter queues a follow-up instead.",
	"Esc stops the run. Ctrl+C clears the editor, or detaches when it's empty.",
	"/new  /resume [n|id|all]  /earlier  /compact [instructions]  /thinking <level>",
	"/detach (leave it running)  /quit (stop it, then leave)  /exit (wait for it, then leave)",
].join("\n");

export interface TuiOptions {
	socketPath: string;
	target: AttachTarget;
	cwd: string;
	env: Record<string, string>;
}

/** Run the client until the user leaves; resolves with the exit code. */
export async function runTui(options: TuiOptions): Promise<number> {
	const client = await PierClient.connect(options.socketPath);
	const conversation = new AttachedConversation(client);
	initTheme();
	const markdownTheme = getMarkdownTheme();

	const terminal = new ProcessTerminal();
	const tui = new TuiMainScreen(terminal);
	const transcript = new Container();
	const notices = new Text("", 1, 0);
	const status = new Text("", 1, 0);
	const editor = new Editor(tui, { borderColor: dim, selectList: getSelectListTheme() });
	tui.addChild(transcript);
	tui.addChild(notices);
	tui.addChild(status);
	tui.addChild(editor);
	tui.setFocus(editor);

	const rendered = new Map<EntryId, Component>();
	let view: TranscriptView | undefined;
	let listing: ConversationSummary[] = [];
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

	const render = () => {
		if (view === undefined) return;
		transcript.clear();
		for (const item of view.items) {
			if (item.kind === "earlier") transcript.addChild(new Text(dim("… earlier messages: /earlier loads them"), 1, 0));
			else if (item.kind === "gap") transcript.addChild(new Text(dim("… some messages aren't loaded"), 1, 0));
			else {
				let component = rendered.get(item.entry.id);
				if (component === undefined) {
					component = renderEntry(item.entry, markdownTheme);
					rendered.set(item.entry.id, component);
				}
				transcript.addChild(component);
			}
		}
		for (const component of renderLive(live(), view.docs["pi.inbox"] as InboxState | undefined, markdownTheme)) {
			transcript.addChild(component);
		}
		status.setText(statusLine(view, conversation.id));
		tui.requestRender();
		if (exitWhenIdle && !busy()) leaving?.(0);
	};
	conversation.subscribe((next) => {
		view = next;
		render();
	});

	const attach = async (target: AttachTarget) => {
		rendered.clear();
		transcript.clear();
		const { created } = await conversation.attach(target, options.cwd, options.env);
		notify(dim(`${created ? "new conversation" : "conversation"} ${conversation.id} in ${options.cwd}`));
	};

	const submit = async (text: string, whenBusy: "steer" | "followUp") => {
		try {
			await client.request("submit", { text, whenBusy });
		} catch (error) {
			notify(red(String(error instanceof Error ? error.message : error)));
		}
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
				const chosen = /^\d+$/.test(argument) ? listing[Number(argument) - 1] : undefined;
				if (chosen !== undefined) return attach({ kind: "id", id: chosen.id });
				if (argument !== "" && argument !== "all") {
					return attach({ kind: "id", id: Number(argument) as never });
				}
				const { conversations } = await client.request("list", {
					...(argument === "all" ? {} : { cwd: options.cwd }),
					limit: 20,
				});
				listing = conversations;
				notify(
					conversations.length === 0
						? dim("no conversations here; /resume all lists every directory")
						: conversations
								.map(
									(summary, index) =>
										`${dim(`${index + 1}.`)} ${summary.title ?? dim("(empty)")} ${dim(
											`#${summary.id}${summary.busy ? " working" : ""}${argument === "all" ? ` ${summary.cwd ?? ""}` : ""}`,
										)}`,
								)
								.join("\n") + dim("\n/resume <n> opens one"),
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
		void action.catch((error: unknown) => notify(red(String(error instanceof Error ? error.message : error))));
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
	void client.closed.then(() => {
		notify(red("the daemon closed the connection"));
		leaving?.(1);
	});
	tui.start();
	try {
		await attach(options.target);
		notify(dim("/help lists the keys and commands"));
	} catch (error) {
		notify(red(String(error instanceof Error ? error.message : error)));
		leaving?.(1);
	}
	const code = await done;
	tui.stop();
	client.close();
	return code;
}

function renderEntry(entry: EntryRecord, markdown: MarkdownTheme): Component {
	const message = entry.model?.[0];
	if (entry.kind === "pi.compaction") return new Text(dim("── earlier messages were summarized ──"), 1, 1);
	if (entry.kind === "pi.reset") return new Text(dim("── a new context starts here ──"), 1, 1);
	if (message === undefined || message.role === "system") return new Container();
	if (message.role === "user") {
		const text = typeof message.content === "string" ? message.content : textParts(message.content);
		return new Text(`${cyan(bold("›"))} ${text}`, 1, 1);
	}
	if (message.role === "assistant") return renderAssistant(message, markdown);
	// A tool result: its last lines, as pi shows them collapsed.
	const output = textParts(message.content).trimEnd();
	const lines = output.split("\n");
	const shown = lines.slice(-8).join("\n");
	const more = lines.length > 8 ? dim(`  … ${lines.length - 8} more lines\n`) : "";
	return new Text(`${more}${(message.isError ? red : dim)(indent(shown || "(no output)"))}`, 1, 0);
}

function renderAssistant(message: AssistantMessage, markdown: MarkdownTheme): Component {
	const container = new Container();
	for (const part of message.content) {
		if (part.type === "text" && part.text.trim() !== "") container.addChild(new Markdown(part.text, 1, 1, markdown));
		else if (part.type === "thinking" && part.thinking.trim() !== "") {
			container.addChild(new Text(dim(`thinking: ${part.thinking.trim().split("\n")[0]?.slice(0, 120)}`), 1, 0));
		} else if (part.type === "toolCall") {
			container.addChild(new Text(`${green("●")} ${bold(part.name)} ${dim(summarizeArgs(part.arguments))}`, 1, 0));
		}
	}
	if (message.stopReason === "error" && message.errorMessage) {
		container.addChild(new Text(red(message.errorMessage), 1, 0));
	}
	return container;
}

function renderLive(live: LiveState, inbox: InboxState | undefined, markdown: MarkdownTheme): Component[] {
	const components: Component[] = [];
	const partial = live.generation?.message as AssistantMessage | undefined;
	if (partial !== undefined) components.push(renderAssistant(partial, markdown));
	if (live.generation?.retry !== undefined) {
		components.push(new Text(yellow(`retrying: ${live.generation.retry.error}`), 1, 0));
	}
	for (const slot of live.tools ?? []) {
		if (slot.status === "done") continue;
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

function statusLine(view: TranscriptView, id: number | undefined): string {
	const agent = (view.docs["pi.agent"] ?? {}) as AgentState;
	const usage = (view.docs["pi.usage"] ?? { models: {} }) as UsageState;
	let tokens = 0;
	for (const entry of Object.values(usage.models ?? {}))
		tokens += entry.input + entry.output + entry.cacheRead + entry.cacheWrite;
	const working = (view.docs["pi.live"] as LiveState | undefined)?.run !== undefined;
	const model = agent.model ? `${agent.model.provider}/${agent.model.modelId}` : "default model";
	return dim(
		[
			working ? yellow("working… Esc stops") : "ready",
			model,
			`thinking ${agent.thinkingLevel ?? "default"}`,
			`${Math.round(tokens / 1000)}k tokens`,
			`#${id ?? "?"}`,
			agent.cwd ?? "",
		].join(" · "),
	);
}

function textParts(content: readonly { type: string; text?: string }[] | string): string {
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`)).join("");
}

function summarizeArgs(args: unknown): string {
	if (args === null || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	const main = record.command ?? record.path ?? record.file_path;
	const text = typeof main === "string" ? main : JSON.stringify(args);
	return text.replace(/\s+/g, " ").slice(0, 100);
}

function indent(text: string): string {
	return text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
}
