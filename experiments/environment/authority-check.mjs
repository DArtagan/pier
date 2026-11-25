// What a tool under the environment contract (todos/environment.md) can still do with
// Will's authority, outside any terminal. Nothing here changes anything: an SSH
// authentication to GitHub (no command runs), and sudo and run0 asked never to prompt.
//   systemd-run --user --wait --pipe --quiet --collect -p WorkingDirectory=$HOME \
//     "$(command -v node)" "$PWD/experiments/environment/authority-check.mjs" "$PWD"
// Plain JavaScript, so it runs without pier's devenv; written 2026-11-24.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const [pierDir] = process.argv.slice(2);
const { NodeExecutionEnv } = await import(join(pierDir, "node_modules/@earendil-works/pi-durable/dist/env/node.js"));
const { BACKGROUND_CONTEXT: context } = await import(
	join(pierDir, "node_modules/@earendil-works/chord/dist/context/index.js")
);
const home = process.env.HOME;
const user = process.env.USER;
const loginShell = spawnSync("getent", ["passwd", user], { encoding: "utf8" }).stdout.trim().split(":")[6];
const probe = spawnSync(loginShell, ["-lc", "env -0"], { env: { HOME: home, USER: user }, encoding: "utf8" });
const probed = Object.fromEntries(
	probe.stdout
		.split("\0")
		.filter(Boolean)
		.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const BASE =
	/^(HOME|USER|LOGNAME|SHELL|PATH|LANG|LC_[A-Z]+|TZ|TZDIR|TMPDIR|LOCALE_ARCHIVE|NIX_PATH|NIX_PROFILES|NIX_USER_PROFILE_DIR|TERMINFO_DIRS|XDG_DATA_DIRS|XDG_CONFIG_DIRS|XDG_RUNTIME_DIR)$/u;
const base = Object.fromEntries(Object.entries(probed).filter(([n]) => BASE.test(n)));
base.TERM = "dumb";

// direnv given the whole login environment, so its diff holds only what the project changed.
for (const [label, input] of [
	["filtered base (22 variables)", base],
	["whole login environment", { ...probed, TERM: "dumb" }],
]) {
	const r = spawnSync("direnv", ["export", "json"], { cwd: pierDir, env: input, encoding: "utf8" });
	const names = Object.keys(JSON.parse(r.stdout || "{}"));
	const desktop = names.filter((n) =>
		/^(GTK|QT|GIO|XCURSOR|CUPS|SSH_ASKPASS|EDITOR|PAGER|SYSTEMD_XKB|NO_AT_BRIDGE|__)/u.test(n),
	);
	console.log(
		`direnv with the ${label}: ${names.length} variables; desktop or profile ones among them: ${desktop.join(" ") || "none"}`,
	);
}

const env = new NodeExecutionEnv({ cwd: home });
async function run(command, vars) {
	let out = "";
	const result = await env.exec(
		command,
		{ inheritEnv: false, env: vars, timeout: 20, onOutput: (t) => (out += t) },
		context,
	);
	return `exit ${result.ok ? result.value.exitCode : result.error.message} | ${out.trim().split("\n").slice(-1)[0]}`;
}
const ssh = "ssh -o BatchMode=yes -o ConnectTimeout=5 -T git@github.com 2>&1";
console.log(`\nssh to GitHub, contract variables only: ${await run(ssh, base)}`);
console.log(
	`ssh to GitHub, naming the keyring's socket by path: ${await run(ssh, { ...base, SSH_AUTH_SOCK: `/run/user/${process.getuid()}/gcr/ssh` })}`,
);
console.log(`sudo, never prompting: ${await run("sudo -n true 2>&1", base)}`);
console.log(`run0, never prompting: ${await run("run0 --no-ask-password true 2>&1", base)}`);
console.log(`a TTY: ${await run("tty 2>&1", base)}`);
