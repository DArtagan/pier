// The system prompt: a short preamble, context files (AGENTS.md), discovered as pi does,
// and the working directory. Skills are a section of their own (`skills.ts`).
// pi-claude-code sends the prompt to Claude as it is.
import { getAgentDir, loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import { defineExtension, type Extension, section } from "@earendil-works/pi-durable";

export interface PromptOptions {
	agentDir?: string;
}

/** The prompt's sections, as an extension to install in the Harness registry. */
export function createPrompt(options: PromptOptions = {}): Extension {
	const agentDir = options.agentDir ?? getAgentDir();

	return defineExtension({
		name: "pier.prompt",
		sections: [
			section("preamble", () => "You are a coding agent. Use the tools to inspect and change the project.", {
				tag: false,
			}),
			section(
				"project_context",
				(input) => {
					const files = loadProjectContextFiles({ cwd: input.agent.cwd ?? process.cwd(), agentDir });
					if (files.length === 0) return;
					return files.map((file) => `## ${file.path}\n\n${file.content}`).join("\n\n");
				},
				{ tag: false },
			),
			section("cwd", (input) => input.agent.cwd),
		],
	});
}
