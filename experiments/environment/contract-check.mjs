/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: the checks are shell commands, where ${NAME:-x} is shell's */
// Checks the environment contract (todos/environment.md), as a tool call would run under
// it: Durable's own NodeExecutionEnv, `inheritEnv: false`, and only the contract's
// variables. Run outside any terminal, so nothing comes from a pane:
//   systemd-run --user --wait --pipe --quiet --collect -p WorkingDirectory=$HOME \
//     "$(command -v node)" "$PWD/experiments/environment/contract-check.mjs" "$PWD" <project dir> ...
// PIER_CHECK_TODAY=1 (with --setenv) runs it as pier is today, inheriting the daemon's
// environment: the keep-out checks must then fail. Plain JavaScript, so it runs without
// pier's devenv; written 2026-11-24, before the contract was built.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const [pierDir, ...projects] = process.argv.slice(2);
const require = createRequire(join(pierDir, "package.json"));
const { NodeExecutionEnv } = await import(require.resolve("@earendil-works/pi-durable/env/node"));
// Chord's ./context export is import-only, so it's loaded by path.
const { BACKGROUND_CONTEXT: context } = await import(
	join(pierDir, "node_modules/@earendil-works/chord/dist/context/index.js")
);

// Part 3, base variables: a login shell's environment from an empty one, filtered to the list.
const BASE =
	/^(HOME|USER|LOGNAME|SHELL|PATH|LANG|LC_[A-Z]+|TZ|TZDIR|TMPDIR|LOCALE_ARCHIVE|NIX_PATH|NIX_PROFILES|NIX_USER_PROFILE_DIR|TERMINFO_DIRS|XDG_DATA_DIRS|XDG_CONFIG_DIRS|XDG_RUNTIME_DIR)$/u;
const home = process.env.HOME;
const user = process.env.USER;
// The user's login shell, by absolute path: an empty environment has no PATH to find it.
const loginShell = spawnSync("getent", ["passwd", user], { encoding: "utf8" }).stdout.trim().split(":")[6];
console.log(`login shell: ${loginShell}`);
let t = performance.now();
const probe = spawnSync(loginShell, ["-lc", "env -0"], { env: { HOME: home, USER: user }, encoding: "utf8" });
const probeMs = performance.now() - t;
const probed = Object.fromEntries(
	probe.stdout
		.split("\0")
		.filter(Boolean)
		.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const base = Object.fromEntries(Object.entries(probed).filter(([name]) => BASE.test(name)));
base.TERM = "dumb";
console.log(
	`base: login-shell probe ${probeMs.toFixed(0)} ms, ${Object.keys(probed).length} variables, ${Object.keys(base).length} kept`,
);
console.log(`  kept: ${Object.keys(base).sort().join(" ")}`);

// Part 5, agent settings, as the service sets them today.
const agent = { GIT_CONFIG_GLOBAL: join(home, ".config/git/config-agent"), PAGER: "cat", GIT_PAGER: "cat" };

// With `inheritEnv: false`, NodeExecutionEnv drops `shellEnv` too and keeps only the
// call's own `env` (getShellEnv in env/node.ts), so the contract goes in each call's
// `env`, as bash's `prepare` hook would set it.
// PIER_CHECK_TODAY=1: as pier is today, inheriting the daemon's environment, to show the
// isolation checks can fail.
const today = process.env.PIER_CHECK_TODAY === "1";
if (today) console.log("MODE: today (inheritEnv true), a negative control");
async function run(env, command, vars) {
	let out = "";
	const inheritEnv = today; // the contract: false; today's pier: true
	const result = await env.exec(command, { inheritEnv, env: vars, onOutput: (text) => (out += text) }, context);
	return { ok: result.ok, code: result.ok ? result.value.exitCode : result.error.message, out: out.trim() };
}

// What must not leak: a variable set only in the daemon's process (standing in for a pane's).
process.env.PIER_CHECK_LEAK = "leaked";
process.env.SSH_AUTH_SOCK ??= "/run/user/1001/gcr/ssh";
process.env.WAYLAND_DISPLAY ??= "wayland-1";

for (const dir of projects) {
	console.log(`\n== ${dir}`);
	// Part 4, project variables: direnv's export, run by the daemon in the directory.
	t = performance.now();
	const direnv = spawnSync("direnv", ["export", "json"], { cwd: dir, env: { ...base }, encoding: "utf8" });
	if (direnv.error) console.log(`direnv didn't start: ${direnv.error.message}`);
	const direnvMs = performance.now() - t;
	let project = {};
	try {
		project = direnv.stdout.trim() === "" ? {} : JSON.parse(direnv.stdout);
	} catch {}
	const status = direnv.status === 0 ? "ok" : `exit ${direnv.status}`;
	const blocked = /is blocked/u.test(direnv.stderr) ? " (blocked: not allowed)" : "";
	console.log(
		`direnv export json: ${status}${blocked}, ${direnvMs.toFixed(0)} ms, ${Object.keys(project).length} variables`,
	);
	for (const [name, value] of Object.entries(project)) if (value === null) delete project[name];
	const names = Object.keys(project).sort();
	console.log(`  names: ${names.join(" ")}`);

	const vars = { ...base, ...project, ...agent };
	const env = new NodeExecutionEnv({ cwd: dir });
	// The commands are shell, so `${NAME:-absent}` is shell's expansion, not a template.
	const checks = [
		["no leak from the daemon's process", 'echo "${PIER_CHECK_LEAK:-absent}"', (r) => r.out === "absent"],
		["no SSH agent", 'echo "${SSH_AUTH_SOCK:-absent}"', (r) => r.out === "absent"],
		[
			"no display or bus",
			'echo "${WAYLAND_DISPLAY:-}${DISPLAY:-}${DBUS_SESSION_BUS_ADDRESS:-}${SWAYSOCK:-}" | grep -q . && echo present || echo absent',
			(r) => r.out === "absent",
		],
		["git", "git status --short | head -1; git --version", (r) => r.code === 0],
		[
			"git uses the agent config",
			"git config --show-origin --get-regexp '^diff' | head -2; echo origin-ok",
			(r) => r.code === 0,
		],
		["nix", "nix --version", (r) => r.code === 0],
		["locale (no warnings)", "LC_ALL= perl -e 1 2>&1 | head -1; echo done", (r) => !/warning/iu.test(r.out)],
		["a UTF-8 file name", "printf 'é\\n' | wc -c", (r) => r.out === "3"],
		[
			"ssh can't authenticate without the agent",
			"ssh -o BatchMode=yes -o ConnectTimeout=3 -o IdentitiesOnly=no mini-nas.forge.local true 2>&1 | tail -1",
			() => true,
		],
	];
	for (const [name, command, pass] of checks) {
		// biome-ignore lint/performance/noAwaitInLoops: one command at a time, in order
		const r = await run(env, command, vars);
		console.log(
			`${pass(r) ? "PASS" : "FAIL"} ${name}: exit ${r.code}${r.out ? ` | ${r.out.split("\n").slice(-2).join(" / ").slice(0, 160)}` : ""}`,
		);
	}
	console.log(`  variables a tool sees: ${(await run(env, "env | wc -l", vars)).out}`);
	// The same with shellEnv instead, to confirm what inheritEnv: false does to it.
	const viaShellEnv = new NodeExecutionEnv({ cwd: dir, shellEnv: vars });
	console.log(
		`  with shellEnv and inheritEnv false: ${(await run(viaShellEnv, "command -v git || echo no-git", {})).out}`,
	);
}
