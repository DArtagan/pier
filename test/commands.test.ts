// The slash commands' menu, in pi's own editor, driven by keys as a person types them:
// `/` lists the commands, letters filter them, a space lists a command's arguments, the
// arrows move, and Enter picks and sends.
import { stripVTControlCharacters } from "node:util";
import { CustomEditor, getSelectListTheme, initTheme } from "@earendil-works/pi-coding-agent";
import type { EntryId } from "@earendil-works/pi-durable";
import { getKeybindings, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { asPicker, type CommandSource, commandCompletions, family } from "../src/host/commands.ts";
import type { ConversationSummary, ModelSummary } from "../src/host/protocol.ts";
import { installKeybindings } from "../src/host/tool-calls.ts";
import { fillHistory } from "../src/host/tui.ts";

const MODELS: ModelSummary[] = [
	{ provider: "claude-code", id: "claude-opus-5-5", thinkingLevels: ["low", "medium", "high", "xhigh", "max"] },
	{ provider: "claude-code", id: "claude-sonnet-5", thinkingLevels: ["off", "low", "medium", "high", "xhigh", "max"] },
];
const CONVERSATIONS: ConversationSummary[] = [
	// A fork of #3 from before its first message: nothing in common with it.
	{
		id: 11 as never,
		number: 5,
		cwd: "/work",
		title: "a fresh start",
		busy: false,
		parent: { number: 3 },
		branch: "a fresh start",
		ownMessages: 1,
		latest: "a fresh start",
	},
	// A fork of #1, which has two messages of its own.
	{
		id: 9 as never,
		number: 3,
		cwd: "/work",
		title: "the first",
		busy: false,
		parent: { number: 1 },
		branch: "a different second",
		ownMessages: 2,
		latest: "and a third",
	},
	{ id: 8 as never, number: 2, cwd: "/elsewhere", title: "somewhere else", busy: true },
	{ id: 7 as never, number: 1, cwd: "/work", title: "the first", busy: false },
];

const source: CommandSource = {
	models: async () => MODELS,
	current: () => ({ model: { provider: "claude-code", modelId: "claude-opus-5-5" }, thinkingLevel: "high", number: 3 }),
	conversations: async () => CONVERSATIONS,
	userMessages: () => [
		{ id: 10 as EntryId, text: "first message" },
		{ id: 20 as EntryId, text: "second message" },
	],
	cwd: "/work",
};

const KEYS = { up: "\x1b[A", down: "\x1b[B", enter: "\r", tab: "\t" };

/** pi's editor, with pier's commands, as the client sets it up; and what it sends. */
function editor() {
	initTheme();
	installKeybindings();
	const tui = { requestRender() {}, terminal: { rows: 40, columns: 100 } } as unknown as TUI;
	const made = new CustomEditor(
		tui,
		{ borderColor: (text: string) => text, selectList: getSelectListTheme() },
		getKeybindings() as ConstructorParameters<typeof CustomEditor>[2],
		{ autocompleteMaxVisible: 10 },
	);
	made.setAutocompleteProvider(commandCompletions(source));
	asPicker(made);
	const sent: string[] = [];
	made.onSubmit = (text) => {
		sent.push(text.trim());
		made.setText("");
	};
	return { editor: made, sent };
}

/** Let the menu's requests (some async) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function type(target: CustomEditor, keys: string): Promise<void> {
	for (const key of keys) {
		target.handleInput(key);
		// biome-ignore lint/performance/noAwaitInLoops: keys are typed one after another
		await settle();
	}
}

const menu = (target: CustomEditor) => stripVTControlCharacters(target.render(100).join("\n"));

describe("the commands' menu", () => {
	it("lists the commands on /, and filters them as letters follow", async () => {
		const { editor: target } = editor();
		await type(target, "/");
		expect(target.isShowingAutocomplete()).toBe(true);
		expect(menu(target)).toContain("thinking");
		expect(menu(target)).toContain("resume");
		await type(target, "thi");
		expect(menu(target)).toContain("thinking");
		expect(menu(target)).not.toContain("resume");
	});

	it("lists a command's arguments once it's chosen, and Enter on one sends it", async () => {
		const { editor: target, sent } = editor();
		await type(target, "/thi");
		// Tab completes the command, and the levels the model supports open at once.
		target.handleInput(KEYS.tab);
		await settle();
		expect(target.getText()).toBe("/thinking ");
		expect(target.isShowingAutocomplete()).toBe(true);
		const shown = menu(target);
		expect(shown).toContain("xhigh");
		expect(shown).toContain("Deep reasoning");
		expect(shown).toContain("(current)");
		// Opus 5.5 can't turn thinking off.
		expect(shown).not.toMatch(/\boff\b/u);
		target.handleInput(KEYS.down);
		target.handleInput(KEYS.enter);
		await settle();
		expect(sent).toEqual(["/thinking medium"]);
	});

	it("filters arguments as letters follow the space", async () => {
		const { editor: target, sent } = editor();
		await type(target, "/model son");
		expect(menu(target)).toContain("claude-sonnet-5");
		expect(menu(target)).not.toContain("claude-opus-5-5");
		target.handleInput(KEYS.enter);
		await settle();
		expect(sent).toEqual(["/model claude-code/claude-sonnet-5"]);
	});

	it("lists conversations for /resume, those here first", async () => {
		const { editor: target, sent } = editor();
		await type(target, "/resume ");
		const shown = menu(target);
		expect(shown.indexOf("#5")).toBeLessThan(shown.indexOf("#3"));
		expect(shown.indexOf("#3")).toBeLessThan(shown.indexOf("#1"));
		expect(shown.indexOf("#1")).toBeLessThan(shown.indexOf("#2"));
		expect(shown).toContain("/elsewhere");
		await type(target, "else");
		target.handleInput(KEYS.enter);
		await settle();
		expect(sent).toEqual(["/resume 2"]);
	});

	it("lists your messages for /fork, newest first, and picks one by its entry", async () => {
		const { editor: target, sent } = editor();
		await type(target, "/fork ");
		const shown = menu(target);
		expect(shown.indexOf("second message")).toBeLessThan(shown.indexOf("first message"));
		target.handleInput(KEYS.down);
		target.handleInput(KEYS.enter);
		await settle();
		expect(sent).toEqual(["/fork 10"]);
	});

	it("sends a command without an argument as it is", async () => {
		const { editor: target, sent } = editor();
		await type(target, "/new");
		target.handleInput(KEYS.enter);
		await settle();
		expect(sent).toEqual(["/new"]);
	});
});

describe("the editor's history", () => {
	it("holds the conversation's messages, newest first under Up, and only that conversation's", () => {
		const { editor: target } = editor();
		fillHistory(target, [{ text: "old one" }, { text: "newer one" }]);
		target.handleInput(KEYS.up);
		expect(target.getText()).toBe("newer one");
		target.handleInput(KEYS.up);
		expect(target.getText()).toBe("old one");

		target.setText("");
		fillHistory(target, [{ text: "another conversation" }]);
		target.handleInput(KEYS.up);
		target.handleInput(KEYS.up);
		expect(target.getText()).toBe("another conversation");
	});
});

describe("family", () => {
	it("lays out a conversation's forks from the root down, whichever is shown", () => {
		const expected = [
			[1, 0],
			[3, 1],
			[5, 2],
		];
		for (const shown of [1, 3, 5]) {
			expect(family(CONVERSATIONS, shown).map(({ summary, depth }) => [summary.number, depth])).toEqual(expected);
		}
		expect(family(CONVERSATIONS, 2).map(({ summary }) => summary.number)).toEqual([2]);
	});
});

describe("/tree's lines", () => {
	it("tells forks apart by their own first message, with how many they have and the newest", async () => {
		const { editor: target } = editor();
		await type(target, "/tree ");
		const shown = menu(target);
		expect(shown).toMatch(/#1\s+the first/u);
		expect(shown).toMatch(/└ #3\s+→ a different second · current · 2 messages · latest: and a/u);
		expect(shown).toMatch(/└ #5\s+→ a fresh start/u);
	});
});
