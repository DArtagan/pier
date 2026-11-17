// The terminal client's slash commands, and pi's autocomplete menu for them: typing `/`
// lists the commands, more letters filter them, and a space after a command lists its
// arguments (`/thinking ` lists the levels). The menu is pi-tui's own
// (`CombinedAutocompleteProvider`, drawn by the editor), as pi's is; pier supplies the
// commands and their arguments' completions, as pi's `createBaseAutocompleteProvider` does.
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { EntryId } from "@earendil-works/pi-durable";
import {
	type AutocompleteItem,
	CombinedAutocompleteProvider,
	fuzzyFilter,
	getKeybindings,
	type SlashCommand,
} from "@earendil-works/pi-tui";
import type { ConversationSummary, ModelSummary } from "./protocol.ts";

/** The commands whose argument is picked from a menu; without one, the menu opens. */
export const PICKED = new Set(["model", "thinking", "resume", "fork", "tree"]);

const COMMANDS: readonly SlashCommand[] = [
	{ name: "model", description: "Change the model", argumentHint: "<provider/model>" },
	{ name: "thinking", description: "Set the thinking level", argumentHint: "<level>" },
	{ name: "resume", description: "Open another conversation", argumentHint: "<number>" },
	{ name: "fork", description: "A new conversation from before one of your messages", argumentHint: "<message>" },
	{ name: "tree", description: "Switch to another branch of this conversation's forks", argumentHint: "<number>" },
	{ name: "new", description: "Start a new conversation here" },
	{ name: "compact", description: "Summarize earlier messages", argumentHint: "[instructions]" },
	{ name: "earlier", description: "Load earlier messages" },
	{ name: "detach", description: "Leave, and let the run go on" },
	{ name: "quit", description: "Stop the run, then leave" },
	{ name: "exit", description: "Leave once the run ends" },
	{ name: "help", description: "Keys and commands" },
];

/** pi's descriptions of its thinking levels (`ThinkingSelectorComponent`; not exported in 1.5.2). */
const LEVELS: Record<ModelThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning (~1k tokens)",
	low: "Light reasoning (~2k tokens)",
	medium: "Moderate reasoning (~8k tokens)",
	high: "Deep reasoning (~16k tokens)",
	xhigh: "Extra-high reasoning (~32k tokens)",
	max: "Maximum reasoning",
};

/** What the commands' completions are made from: the daemon's, and the transcript's. */
export interface CommandSource {
	/** The models the daemon can run. */
	models(): Promise<readonly ModelSummary[]>;
	/** The attached conversation's model and thinking level, from its view. */
	current(): { model?: { provider: string; modelId: string }; thinkingLevel?: string; number?: number };
	/** Every conversation, newest first. */
	conversations(): Promise<readonly ConversationSummary[]>;
	/** The user messages loaded in the transcript, oldest first. */
	userMessages(): readonly { id: EntryId; text: string }[];
	/** The directory the client runs in. */
	cwd: string;
}

/** pi's text to match a model against (`getModelSearchText`; not exported in 1.5.2). */
function modelSearchText(model: ModelSummary): string {
	const name = model.name === undefined ? "" : ` ${model.name}`;
	return `${model.id} ${model.provider} ${model.provider}/${model.id} ${model.provider} ${model.id}${name}`;
}

const items = <T>(
	all: readonly T[],
	prefix: string,
	text: (item: T) => string,
	item: (item: T) => AutocompleteItem,
): AutocompleteItem[] | null => {
	const found = fuzzyFilter([...all], prefix, text);
	return found.length === 0 ? null : found.map(item);
};

/** One line of a message, for a menu. */
const oneLine = (text: string, length = 70) => {
	const line = text.replace(/\s+/gu, " ").trim();
	return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

/** The thinking levels `model` supports; every level if it isn't known. */
export function thinkingLevels(
	models: readonly ModelSummary[],
	model: { provider: string; modelId: string } | undefined,
) {
	const found = models.find((each) => each.provider === model?.provider && each.id === model?.modelId);
	return found?.thinkingLevels ?? (Object.keys(LEVELS) as ModelThinkingLevel[]);
}

/**
 * The conversations of `current`'s tree of forks, from its root down, each after the one
 * it was forked from, with how deep it is.
 */
export function family(
	conversations: readonly ConversationSummary[],
	current: number,
): { summary: ConversationSummary; depth: number }[] {
	const byNumber = new Map(conversations.map((summary) => [summary.number, summary]));
	let root = byNumber.get(current);
	const seen = new Set<number>();
	while (root?.parent !== undefined && !seen.has(root.number)) {
		seen.add(root.number);
		const parent = byNumber.get(root.parent.number);
		if (parent === undefined) break;
		root = parent;
	}
	if (root === undefined) return [];
	const children = new Map<number, ConversationSummary[]>();
	for (const summary of conversations) {
		if (summary.parent === undefined) continue;
		children.set(summary.parent.number, [...(children.get(summary.parent.number) ?? []), summary]);
	}
	const tree: { summary: ConversationSummary; depth: number }[] = [];
	const visit = (summary: ConversationSummary, depth: number) => {
		tree.push({ summary, depth });
		const below = (children.get(summary.number) ?? []).sort((a, b) => a.number - b.number);
		for (const child of below) visit(child, depth + 1);
	};
	visit(root, 0);
	return tree;
}

/** pi's autocomplete, with pier's commands and their arguments' completions. */
export function commandCompletions(source: CommandSource): CombinedAutocompleteProvider {
	const commands = COMMANDS.map((command): SlashCommand => ({ ...command }));
	const complete = (name: string, completions: NonNullable<SlashCommand["getArgumentCompletions"]>) => {
		const command = commands.find((each) => each.name === name);
		if (command !== undefined) command.getArgumentCompletions = completions;
	};
	complete("model", async (prefix) => {
		const current = source.current().model;
		// The current model's provider first (Claude Code's, before pi's own logins), each in the daemon's order.
		const all = await source.models();
		const sorted = [
			...all.filter((model) => model.provider === current?.provider),
			...all.filter((model) => model.provider !== current?.provider),
		];
		return items(sorted, prefix, modelSearchText, (model) => ({
			value: `${model.provider}/${model.id}`,
			label: model.id,
			description:
				model.provider === current?.provider && model.id === current.modelId
					? `${model.provider} (current)`
					: model.provider,
		}));
	});
	complete("thinking", async (prefix) => {
		const { model, thinkingLevel } = source.current();
		const levels = thinkingLevels(await source.models(), model);
		return items(
			levels,
			prefix,
			(level) => level,
			(level) => ({
				value: level,
				label: level,
				description: level === thinkingLevel ? `${LEVELS[level]} (current)` : LEVELS[level],
			}),
		);
	});
	complete("resume", async (prefix) => {
		const current = source.current().number;
		// Those here first, then the rest, each newest first.
		const all = await source.conversations();
		const here = all.filter((summary) => summary.cwd === source.cwd);
		const elsewhere = all.filter((summary) => summary.cwd !== source.cwd);
		return items(
			[...here, ...elsewhere],
			prefix,
			(summary) => `${summary.number} ${summary.title ?? ""} ${summary.cwd ?? ""}`,
			(summary) => ({
				value: String(summary.number),
				label: `#${summary.number}  ${oneLine(summary.title ?? "(empty)", 50)}`,
				description: [
					summary.number === current ? "current" : undefined,
					summary.busy ? "working" : undefined,
					summary.cwd === source.cwd ? undefined : summary.cwd,
				]
					.filter((part) => part !== undefined)
					.join(" · "),
			}),
		);
	});
	complete("fork", (prefix) =>
		items(
			[...source.userMessages()].reverse(),
			prefix,
			(message) => message.text,
			(message) => ({ value: String(message.id), label: oneLine(message.text) }),
		),
	);
	complete("tree", async (prefix) => {
		const current = source.current().number;
		if (current === undefined) return null;
		const now = Date.now();
		return items(
			family(await source.conversations(), current),
			prefix,
			({ summary }) => `${summary.number} ${summary.title ?? ""} ${summary.branch ?? ""} ${summary.latest ?? ""}`,
			// pi-tui's menu cuts its first column at 32 characters: the tree's lines and numbers
			// there, the messages in the second.
			({ summary, depth }) => ({
				value: String(summary.number),
				label: `${depth === 0 ? "" : `${"  ".repeat(depth - 1)}└ `}#${summary.number}`,
				description: [treeLabel(summary), treeDescription(summary, current, now)]
					.filter((part) => part !== "")
					.join(" · "),
			}),
		);
	});
	// pi's file completion (`@`, and Tab) needs `fd`, which pier doesn't fetch as pi does:
	// without it, the provider still completes paths from a directory listing.
	return new CombinedAutocompleteProvider(commands, source.cwd, null);
}

/**
 * A conversation in `/tree`, by what sets it apart: a fork by its first message of its
 * own (all of one conversation's forks share its first message), the root by its first.
 */
export function treeLabel(summary: ConversationSummary): string {
	if (summary.parent === undefined) return oneLine(summary.title ?? "(empty)", 50);
	return summary.branch === undefined ? "(forked, nothing sent yet)" : `→ ${oneLine(summary.branch, 48)}`;
}

/** What else `/tree` says of a conversation: its own messages, its newest, how long ago, and whether it's the one shown. */
export function treeDescription(summary: ConversationSummary, current: number, now: number): string {
	const own = summary.ownMessages;
	return [
		summary.number === current ? "current" : undefined,
		summary.busy ? "working" : undefined,
		own === undefined || own < 2 ? undefined : `${own} messages`,
		summary.latest !== undefined && summary.latest !== summary.branch && summary.latest !== summary.title
			? `latest: ${oneLine(summary.latest, 40)}`
			: undefined,
		summary.active === undefined ? undefined : ago(now - summary.active),
	]
		.filter((part) => part !== undefined)
		.join(" · ");
}

/** "3m ago", "2h ago", "4d ago". */
function ago(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / 60_000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** pi-tui's editor opens its menu as a key does with this; private in its types, a method in its code. */
interface Triggers {
	tryTriggerAutocomplete?: () => void;
}

/**
 * pi's editor, with its menu one step closer to a picker: a command whose argument is
 * picked opens the argument menu once the command is complete (`/thinking ` lists the
 * levels at once, as the menu doesn't by itself after Tab), and Enter on an argument both
 * picks it and sends the command, where pi's editor needs a second Enter.
 */
export function asPicker(editor: CustomEditor): void {
	const handle = editor.handleInput.bind(editor);
	editor.handleInput = (data: string) => {
		const picking =
			editor.isShowingAutocomplete() &&
			/^\/\S+ /u.test(editor.getText()) &&
			getKeybindings().matches(data, "tui.select.confirm");
		const before = editor.getText();
		handle(data);
		const text = editor.getText();
		if (picking && !editor.isShowingAutocomplete()) {
			editor.onSubmit?.(text);
			return;
		}
		if (text !== before) openArguments(editor);
	};
}

/** Open the argument menu if the editor holds just a command whose argument is picked, and a space. */
export function openArguments(editor: CustomEditor): void {
	const command = /^\/(\S+) $/u.exec(editor.getText())?.[1];
	if (command === undefined || !PICKED.has(command) || editor.isShowingAutocomplete()) return;
	(editor as unknown as Triggers).tryTriggerAutocomplete?.();
}
