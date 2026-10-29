// The system prompt: context files (AGENTS.md) and skills, discovered as pi does, plus the
// working directory. pi's own harness text is deliberately absent: claude-bridge runs
// Claude Code with its own preset and forwards only these portable parts.
import {
	formatSkillsForPrompt,
	getAgentDir,
	loadProjectContextFiles,
	loadSkills,
} from "@earendil-works/pi-coding-agent";
import { defineExtension, type Extension, section } from "@earendil-works/pi-durable";
import type { SystemPromptOptions } from "./bridge/shim.ts";

export interface PromptOptions {
	agentDir?: string;
	/** Skill files or directories beyond pi's default locations (settings.json `skills`). */
	skillPaths?: string[];
}

export interface Prompt {
	readonly extension: Extension;
	/** The same parts as the sections, for the bridge's prompt capture. */
	options(cwd: string): SystemPromptOptions;
}

export function createPrompt(options: PromptOptions = {}): Prompt {
	const agentDir = options.agentDir ?? getAgentDir();
	const parts = (cwd: string) => ({
		contextFiles: loadProjectContextFiles({ cwd, agentDir }),
		skills: loadSkills({ cwd, agentDir, skillPaths: options.skillPaths ?? [], includeDefaults: true }).skills,
	});

	const extension = defineExtension({
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

	return { extension, options: (cwd) => parts(cwd) };
}
