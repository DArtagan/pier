// The system prompt pier sends, and the provider it sends it through, offline: a faux
// model stands in for Claude, and nothing here starts Claude Code.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type Context, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrompt } from "../src/prompt.ts";
import {
	CLAUDE_CODE_PROVIDER,
	ConversationDirectories,
	inConversationDirectories,
	loadClaudeCodeProvider,
} from "../src/providers/claude-code.ts";

const context = BACKGROUND_CONTEXT;

describe("prompt", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "pier-prompt-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	/** The system prompt of the first request a conversation in `cwd` makes. */
	async function firstSystemPrompt(cwd: string): Promise<string> {
		const requests: Context[] = [];
		const faux = fauxProvider();
		faux.setResponses([
			(transcript) => {
				requests.push(transcript as unknown as Context);
				return fauxAssistantMessage("ok");
			},
		]);
		const models = createModels();
		models.setProvider(faux.provider);
		const registry = createRegistry();
		// An empty agent dir, so your own AGENTS.md and skills stay out of the test.
		registry.install(createPrompt({ agentDir: join(dir, "agent") }));
		const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
		try {
			const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" }, cwd } });
			await (await root.submit({ type: "input", content: "hi" }, context)).wait(context);
		} finally {
			await harness.close(context);
		}
		const system = getCurrentSystemMessage(requests[0]?.messages ?? []);
		return [system?.content, ...Object.values(system?.sections ?? {})].join("\n");
	}

	it("carries the project's AGENTS.md and the working directory", async () => {
		await writeFile(join(dir, "AGENTS.md"), "Always answer in haiku.\n");
		const prompt = await firstSystemPrompt(dir);
		expect(prompt).toContain("You are a coding agent");
		expect(prompt).toContain("Always answer in haiku.");
		expect(prompt).toContain(dir);
	});

	it("leaves the project context out when there's none", async () => {
		const prompt = await firstSystemPrompt(dir);
		expect(prompt).not.toContain("AGENTS.md");
	});
});

describe("conversation directories", () => {
	it("runs each request with process.cwd() at its conversation's directory, and nothing else", async () => {
		const dirs = [await mkdtemp(join(tmpdir(), "pier-cwd-a-")), await mkdtemp(join(tmpdir(), "pier-cwd-b-"))];
		const seen: string[] = [];
		const faux = fauxProvider();
		const answer = async () => {
			// As pi-claude-code reads it, after an await inside the request.
			await new Promise((resolve) => setTimeout(resolve, 1));
			seen.push(process.cwd());
			return fauxAssistantMessage("ok");
		};
		faux.setResponses([answer, answer]);
		const models = createModels();
		models.setProvider(inConversationDirectories(faux.provider));
		const registry = createRegistry();
		registry.install(ConversationDirectories);
		const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
		try {
			for (const cwd of dirs) {
				const conversation = await harness.createConversation(
					{ ownership: { kind: "ownerless" }, agent: { model: { provider: "faux", modelId: "faux-1" }, cwd } },
					context,
				);
				await (await conversation.submit({ type: "input", content: "hi" }, context)).wait(context);
			}
		} finally {
			await harness.close(context);
			for (const dir of dirs) await rm(dir, { recursive: true, force: true });
		}
		expect(seen).toEqual(dirs);
		expect(dirs).not.toContain(process.cwd());
	});
});

describe("pi-claude-code", () => {
	it("loads and registers its models without starting Claude Code", async () => {
		const models = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
		models.registerNativeProvider(await loadClaudeCodeProvider());
		expect(models.getModels(CLAUDE_CODE_PROVIDER).map((model) => model.id)).toContain("claude-opus-5-5");
	});
});
