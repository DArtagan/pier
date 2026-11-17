// The skills the model is offered: the skill directories pier is given (the tools',
// each from its package's `share/skills/<pname>`) and the project's own, listed in one
// section as pi lists them (agentskills.io's catalog: name, description, location). The
// model reads a skill's SKILL.md with the read tool when a task matches it.
//
// One extension owns the list, as p2's prompt plugin does. Tools that bring a skill
// along with code of their own can later add their directories to it, as p2's plugins
// add theirs to `PluginSkills`, without writing a list of their own.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { formatSkillsForPrompt, loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";
import { defineExtension, type Extension, section } from "@earendil-works/pi-durable";

export interface SkillsOptions {
	/**
	 * Skill directories: each one skill (holding SKILL.md) or a directory of them, such as
	 * a package's `share/skills/<pname>`. On a name clash the earlier one wins, and a
	 * project's skill wins over all of them.
	 */
	paths?: readonly string[];
}

/**
 * The project's skill directories, nearest first: `.agents/skills` and `.pi/skills` in
 * `cwd` and each directory above it, up to the repository's root (as pi walks
 * `.agents/skills`). Outside a repository, `cwd`'s only: the directories that hold a
 * project, home among them, aren't part of it.
 */
export function projectSkillDirs(cwd: string): string[] {
	const start = resolve(cwd);
	const root = repositoryRoot(start) ?? start;
	const dirs: string[] = [];
	for (let dir = start; ; dir = dirname(dir)) {
		dirs.push(join(dir, ".agents", "skills"), join(dir, ".pi", "skills"));
		if (dir === root || dirname(dir) === dir) return dirs;
	}
}

function repositoryRoot(dir: string): string | undefined {
	for (let current = dir; ; current = dirname(current)) {
		if (existsSync(join(current, ".git"))) return current;
		if (dirname(current) === current) return undefined;
	}
}

/**
 * The skills a conversation in `cwd` is offered: the project's first, nearest first, then
 * `paths` in order. The first skill of a name wins, so a project can stand in for a
 * tool's skill. Skills marked `disable-model-invocation` are left out of the list.
 */
export function discoverSkills(cwd: string, paths: readonly string[] = []): Skill[] {
	const byName = new Map<string, Skill>();
	for (const dir of [...projectSkillDirs(cwd), ...paths]) {
		for (const skill of loadSkillsFromDir({ dir, source: "pier" }).skills) {
			if (!byName.has(skill.name)) byName.set(skill.name, skill);
		}
	}
	return [...byName.values()];
}

/** The skills section, as an extension to install in the Harness registry. */
export function createSkills(options: SkillsOptions = {}): Extension {
	return defineExtension({
		name: "pier.skills",
		sections: [
			section(
				"skills",
				(input) => {
					// Read anew before each request, so a skill added or changed shows on the next one.
					const skills = discoverSkills(input.agent.cwd ?? process.cwd(), options.paths);
					const text = formatSkillsForPrompt(skills, "read");
					return text === "" ? undefined : text;
				},
				{ tag: false },
			),
		],
	});
}
