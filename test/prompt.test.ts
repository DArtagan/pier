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
import { CLAUDE_CODE_PROVIDER, loadClaudeCodeProvider } from "../src/providers/claude-code.ts";

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

describe("pi-claude-code", () => {
	it("loads and registers its models without starting Claude Code", async () => {
		const models = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
		models.registerNativeProvider(await loadClaudeCodeProvider());
		expect(models.getModels(CLAUDE_CODE_PROVIDER).map((model) => model.id)).toContain("claude-opus-5-5");
	});
});
