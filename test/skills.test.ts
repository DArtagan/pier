// The skills the model is offered, offline: the directories pier is given and the
// project's own, in the prompt a faux model receives, and PIER_SKILLS.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type Context, getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillPaths } from "../src/host/paths.ts";
import { createSkills, discoverSkills, projectSkillDirs } from "../src/layer/skills.ts";

const context = BACKGROUND_CONTEXT;

describe("skills", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "pier-skills-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	/** A skill, `<root>/<name>/SKILL.md`; returns its directory. */
	async function skill(root: string, name: string, description = `The ${name} skill.`): Promise<string> {
		const skillDir = join(root, name);
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
		return skillDir;
	}

	/** The system prompt of the first request a conversation in `cwd` makes, offered `paths`. */
	async function firstSystemPrompt(cwd: string, paths: string[]): Promise<string> {
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
		registry.install(createSkills({ paths }));
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

	it("lists the skills of the directories it's given, a package's share/skills/<pname> or one skill's", async () => {
		// As nixpkgs' installAgentSkills lays them out: gog's two skills side by side.
		const gog = join(dir, "gog", "share", "skills", "gog");
		await skill(gog, "gog");
		await skill(gog, "gog-calendar");
		const ketch = await skill(join(dir, "ketch", "share", "skills", "ketch"), "ketch");
		const project = join(dir, "project");
		await mkdir(project);
		const prompt = await firstSystemPrompt(project, [gog, ketch]);
		expect(prompt).toContain("<available_skills>");
		for (const name of ["gog", "gog-calendar", "ketch"]) expect(prompt).toContain(`<name>${name}</name>`);
		expect(prompt).toContain(join(ketch, "SKILL.md"));
	});

	it("offers no skills section when there are none", async () => {
		const prompt = await firstSystemPrompt(dir, []);
		expect(prompt).not.toContain("available_skills");
	});

	it("adds the project's .agents/skills and .pi/skills, up to the repository's root, and its skill wins a name", async () => {
		const repo = join(dir, "repo");
		await mkdir(join(repo, ".git"), { recursive: true });
		const cwd = join(repo, "packages", "app");
		await skill(join(cwd, ".pi", "skills"), "nearest");
		await skill(join(repo, ".agents", "skills"), "ketch", "The project's own ketch.");
		// Above the repository: not the project's.
		await skill(join(dir, ".agents", "skills"), "outside");
		const tool = await skill(join(dir, "store"), "ketch", "The packaged ketch.");
		const names = discoverSkills(cwd, [tool]).map((found) => `${found.name}: ${found.description}`);
		expect(names).toEqual(["nearest: The nearest skill.", "ketch: The project's own ketch."]);
	});

	it("walks no further than the directory itself outside a repository", () => {
		const cwd = join(dir, "notes");
		expect(projectSkillDirs(cwd)).toEqual([join(cwd, ".agents", "skills"), join(cwd, ".pi", "skills")]);
	});
});

describe("PIER_SKILLS", () => {
	it("is a list of absolute paths, separated as PATH is", () => {
		expect(skillPaths({ PIER_SKILLS: "/a/share/skills/ketch::/b/share/skills/gog" })).toEqual([
			"/a/share/skills/ketch",
			"/b/share/skills/gog",
		]);
		expect(skillPaths({})).toEqual([]);
	});

	it("refuses a relative path, which the daemon, in its state directory, would misread", () => {
		expect(() => skillPaths({ PIER_SKILLS: "/a:share/skills/ketch" })).toThrow(/relative path, share\/skills\/ketch/u);
	});
});
