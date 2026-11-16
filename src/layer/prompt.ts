// The system prompt: a short preamble, context files (AGENTS.md) and skills, discovered
// as pi does, and the working directory. pi-claude-code sends it to Claude as it is.
import {
	formatSkillsForPrompt,
	getAgentDir,
	loadProjectContextFiles,
	loadSkills,
} from "@earendil-works/pi-coding-agent";
import { defineExtension, type Extension, section } from "@earendil-works/pi-durable";

export interface PromptOptions {
	agentDir?: string;
	/** Skill files or directories beyond pi's default locations (settings.json `skills`). */
	skillPaths?: string[];
}

/** The prompt's sections, as an extension to install in the Harness registry. */
export function createPrompt(options: PromptOptions = {}): Extension {
	const agentDir = options.agentDir ?? getAgentDir();
	const parts = (cwd: string) => ({
		contextFiles: loadProjectContextFiles({ cwd, agentDir }),
		skills: loadSkills({ cwd, agentDir, skillPaths: options.skillPaths ?? [], includeDefaults: true }).skills,
	});

	return defineExtension({
		name: "pier.prompt",
		sections: [
			section("preamble", () => "You are a coding agent. Use the tools to inspect and change the project.", {
				tag: false,
			}),
			section(
				"project_context",
				(input) => {
					const files = parts(input.agent.cwd ?? process.cwd()).contextFiles;
					if (files.length === 0) return undefined;
					return files.map((file) => `## ${file.path}\n\n${file.content}`).join("\n\n");
				},
				{ tag: false },
			),
			section(
				"skills",
				(input) => {
					const skills = parts(input.agent.cwd ?? process.cwd()).skills;
					return skills.length === 0 ? undefined : formatSkillsForPrompt(skills, "read");
				},
				{ tag: false },
			),
			section("cwd", (input) => input.agent.cwd),
		],
	});
}
