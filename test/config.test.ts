// The daemon's configuration file: where it is, what it may hold, and how PIER_*
// variables override it.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, describeConfig, parseConfig, readConfig } from "../src/host/config.ts";
import { defaultModel, defaultThinkingLevel } from "../src/host/defaults.ts";
import { skillPaths } from "../src/host/paths.ts";

describe("configPath", () => {
	it("is $PIER_CONFIG, else config.yaml in $XDG_CONFIG_HOME/pier", () => {
		expect(configPath({ PIER_CONFIG: "/etc/pier.yaml", XDG_CONFIG_HOME: "/x" })).toBe("/etc/pier.yaml");
		expect(configPath({ XDG_CONFIG_HOME: "/x" })).toBe("/x/pier/config.yaml");
		expect(configPath({})).toMatch(/\/\.config\/pier\/config\.yaml$/u);
	});
});

describe("readConfig", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "pier-config-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("is empty when there's no file", async () => {
		expect(await readConfig(join(dir, "config.yaml"))).toEqual({});
	});

	it("reads every setting", async () => {
		const path = join(dir, "config.yaml");
		await writeFile(
			path,
			[
				"# pier's configuration",
				"model: claude-code/claude-sonnet-5-5",
				"thinking: medium",
				"skills:",
				"  - /nix/store/a/share/skills/ketch",
				"tools:",
				"  variables:",
				"    GIT_CONFIG_GLOBAL: /home/will/.config/git/config-agent",
				"    PAGER: cat",
				"  timeout: 600",
				"",
			].join("\n"),
		);
		expect(await readConfig(path)).toEqual({
			model: "claude-code/claude-sonnet-5-5",
			thinking: "medium",
			skills: ["/nix/store/a/share/skills/ketch"],
			tools: { variables: { GIT_CONFIG_GLOBAL: "/home/will/.config/git/config-agent", PAGER: "cat" }, timeout: 600 },
		});
	});
});

describe("parseConfig", () => {
	const refused = (text: string, message: RegExp) => expect(() => parseConfig(text, "/c.yaml")).toThrow(message);

	it("takes an empty file, or one of comments, as empty", () => {
		expect(parseConfig("", "/c.yaml")).toEqual({});
		expect(parseConfig("# nothing yet\n", "/c.yaml")).toEqual({});
	});

	it("refuses what isn't YAML, naming the file", () => {
		refused("tools: [", /^\/c\.yaml isn't YAML: /u);
	});

	it("refuses what doesn't fit, naming the file and the field", () => {
		refused("- a list", /^\/c\.yaml doesn't fit pier's configuration: \/ expected object/u);
		// A misspelt key isn't silently ignored.
		refused("modle: faux/faux-1", /\/modle unknown field/u);
		refused("thinking: HIGH", /\/thinking/u);
		refused("model: opus", /\/model/u);
		refused("skills: [share/skills/ketch]", /\/skills\/0/u);
		refused("tools: { timeout: 0 }", /\/tools\/timeout expected > 0/u);
		refused("tools: { shell: zsh }", /\/tools\/shell unknown field/u);
	});

	it("closes YAML's implicit types: a value that parses as a number or boolean isn't a string", () => {
		// `PAGER: 1.10` would quietly become "1.1"; it must be quoted.
		refused("tools: { variables: { VERSION: 1.10 } }", /\/tools\/variables\/VERSION expected string/u);
		refused("tools: { variables: { ENABLED: true } }", /\/tools\/variables\/ENABLED expected string/u);
		expect(parseConfig('tools: { variables: { VERSION: "1.10" } }', "/c.yaml").tools?.variables).toEqual({
			VERSION: "1.10",
		});
	});
});

describe("the configuration under PIER_* variables", () => {
	const config = parseConfig("model: faux/faux-2\nthinking: low\nskills: [/from/config]\n", "/c.yaml");

	it("is what the daemon runs with when no variable is set", () => {
		expect(defaultModel({}, config)).toEqual({ provider: "faux", modelId: "faux-2" });
		expect(defaultThinkingLevel({}, config)).toBe("low");
		expect(skillPaths({}, config)).toEqual(["/from/config"]);
	});

	it("gives way to a variable that is", () => {
		expect(defaultModel({ PIER_MODEL: "faux/faux-1" }, config)).toEqual({ provider: "faux", modelId: "faux-1" });
		expect(defaultThinkingLevel({ PIER_THINKING: "off" }, config)).toBe("off");
		expect(skillPaths({ PIER_SKILLS: "/from/env" }, config)).toEqual(["/from/env"]);
	});

	it("is said, for the log, without the tools' variables' values", () => {
		expect(describeConfig({})).toBe("(empty)");
		expect(describeConfig({ ...config, tools: { variables: { GH_TOKEN: "secret" }, timeout: 600 } })).toBe(
			"model faux/faux-2, thinking low, skills /from/config, tools.variables GH_TOKEN, tools.timeout 600s",
		);
	});
});
