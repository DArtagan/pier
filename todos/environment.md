# The environment contract: what a conversation's tools run with

## Opening prompt

> Read `docs/principles.md`, then `todos/environment.md`, then `todos/remote.md`
> (component 4). Will asked for a formal contract of what a tool's environment is, with
> everything outside it kept out, and then a choice of how each part is provided. Put
> the open questions below to him, and record his answers here verbatim and dated.
> Nothing is built until he has chosen. Check every measurement below again before
> relying on it.

Written 2026-11-24. Will's words that day: *"Passing through the pane's whole environment
might not be the best plan after all. Please research and report on some alternative
options."* And: *"A good place to start might be by explicitly defining what the parts of
an "environment" are (e.g. working directory, environment variables, etc.). That will
form a formal interface contract, and anything not in that contract should be isolated
away/disallowed. After doing that, we can determine how each component in the interface
contract is provided."*

It reopens his decision of 2026-10-29 (`docs/history.md`): *"Yes, for now keep it simple
by passing through the whole environment. We can refine it later."* It's a spec of its
own, not part of `todos/remote.md`, because it changes local panes as much as remote
ones. Remote pier needs it settled first: a remote pane's environment is meaningless on
the far host (`todos/remote.md`, component 4).

Everything below is Claude's proposal until Will agrees.

## Findings

### What changed upstream since 2026-11-18 (read 2026-11-24)

- **pier is on pi 1.6.0 and Node 26** (`main` at 0.7.0, PR #20). Nothing in 1.6.0
  changes how a tool's environment is built: `ExecutionEnv`, `NodeExecutionEnv` and its
  `shellEnv` are as in 1.5.2, and pi-env's `RemoteExecutionEnv` takes the same `cwd`,
  `shellPath` and `shellEnv`. 1.6.0's changes are elsewhere: signals, tools that park,
  hooks that start tasks, blocked tasks, and provider sessions released when the Harness
  closes. Tools that park matter later, for a tool that waits for Will's approval.
- **Durable's unreleased `main`** (`8209929`, 2026-11-24) tags its unions with `kind`
  and renames `submit(tx, …)` to `admit`. It changes nothing about environments.
- **p3** (`main`; newest p3 commit `753bc0b`, 2026-11-20):
  - Slice 8 (environments) decided on one SSH connection per worker for remote
    environments, reused for everything. The process that runs a conversation holds its
    far machine's connection, which is model C's shape (`todos/remote.md`).
  - Slice 27 (the terminal client) keeps a client's data on the device, not in a Pi:
    sign-ins live in `~/.pi/p3-terminal/`, outside every Pi's data directory. That's the
    reverse of `todos/remote.md`'s proposal to keep remotes in the daemon's storage.
    The cases differ, though: pier's remotes are what one pier reaches, not a device's
    sign-ins. Worth weighing again when the remotes are built.
  - Remote access (slice 21) and pairing (slice 25) are still briefs.
  - Node 26 everywhere (decided 2026-11-18), which pier now follows.
  - Nothing changes `todos/remote.md`'s decisions.

### What a tool runs with today (Durable 1.6.0's `env/node.ts`, pier 0.7.0)

A tool reaches the machine through Durable's `ExecutionEnv`: a `FileSystem` (read, write,
list, watch) and a `Shell` (`exec`, `cleanup`). `NodeExecutionEnv` runs a command as
`spawn(bash, ["-c", command])`. The command is detached, in a process group of its own,
with stdin closed. Its environment is `process.env`, then `shellEnv`, then the call's own
`env`, each laid over the one before. Everything else it inherits from the daemon's
process. In pier today:

| Part | Where it comes from |
|---|---|
| Working directory | the conversation's `cwd` (`pi.agent`), from the pane that created it |
| Variables | the daemon's service environment, under the *whole* environment of the last pane that attached (`pier.client-env`, replaced on every attach) |
| Shell | `/bin/bash`, or bash on `PATH`, with `-c`: not a login shell |
| User, groups, umask, limits | the daemon's, a systemd user service |
| Files | everything the user can reach |
| Network | everything the machine can reach |
| Credentials | whatever the variables point at (an agent's socket, a token), and every file the user can read (`~/.ssh`, `~/.config/gh/hosts.yml`) |
| Processes, devices | the user's: `/proc`, `kill`, the display, D-Bus |

Measured on thenixbeast, 2026-11-24:

- A tmux pane in a devenv project has 155 variables (19.6 KB). The daemon's service has
  53. A login shell started from an empty environment (`env -i HOME USER bash -lc env`)
  has 48.
- The pane's include:
  - `SSH_AUTH_SOCK`, the GNOME keyring's agent, so an unlocked key is usable;
  - `DBUS_SESSION_BUS_ADDRESS`, `WAYLAND_DISPLAY`, and `SWAYSOCK`, which can drive the
    window manager;
  - `TMUX` and `TMUX_PANE`, which can type into other panes;
  - `ALACRITTY_SOCKET`;
  - nix-shell's compiler variables, and devenv's.
- None is a secret by its name today, but anything exported in a pane later is passed
  on too. All of it is stored in the SQLite file, which is backed up.

### Prior art (read 2026-11-24)

- **Codex CLI** (`shell_environment_policy`; `codex-rs/protocol/src/shell_environment.rs`
  on `main`) comes closest to a contract:
  - It starts from `inherit = all | core | none`, where `core` is `PATH SHELL TMPDIR TEMP
    TMP HOME LANG LC_ALL LC_CTYPE LOGNAME USER`.
  - It then optionally drops names matching `*KEY*`, `*SECRET*` and `*TOKEN*`, applies
    the user's excludes, adds the user's `set`, and keeps only `include_only`.
  - A fixed list of Codex's own credentials is never passed on, whatever the settings.
  - An opt-in, `experimental_use_profile`, runs the user's shell profile.
  - Its docs say this isn't a sandbox; `sandbox_mode` is.
- **Dev containers** (`devcontainer.json`, the spec's reference) keep three things apart:
  - `containerEnv`, fixed for the container;
  - `remoteEnv`, for the tool and its terminals. It can name a local variable, one at a
    time (`${localEnv:X}`);
  - `userEnvProbe`, which runs the remote user's shell (`loginInteractiveShell` by
    default) to read *their* environment on the far side.

  The client's environment never crosses whole.
- **Zed** (`zed.dev/docs/environment`) gets a project's environment by running a login
  shell in the project's directory, which picks up direnv, asdf or mise. It does the same
  on the far side of an SSH project; direnv there was a bug once (zed-industries/zed#20477,
  closed 2025). Only a launch from the `zed` command passes the launching shell's
  environment on.
- **Claude Code** passes its own environment to its tools.
  `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`:
  - strips credentials, recognised by name or by the shape of the value (keeping
    `GITHUB_TOKEN`, proxies and `GIT_CONFIG_*`);
  - on Linux, runs bash in a PID namespace of its own, so `/proc` can't show other
    processes' environments;
  - is, in its own docs, "one layer alongside narrow permission rules".

  `CLAUDE_ENV_FILE` names a script to source before each command, for virtualenvs and
  the like. pi-claude-code passes the daemon's environment to Claude Code without
  `ANTHROPIC_API_KEY` (`claude-cli.ts`, `claudeEnvironment`).
- **Classic pi** passes its whole environment, and `shellCommandPrefix` runs before every
  command.
- **Durable's bash** has the hook pier would use: `createBashTool({ prepare })` gets each
  call's `cwd`, `env` and `inheritEnv` before it runs (there since 1.5.2).
  `inheritEnv: false` gives a command only the variables it's given, not `process.env`.
- **p2** (`apps/p2/docs/remote-envs.md`) treats an environment as a named configuration:
  `host`, `user`, `shellPath`, `loginShell`, and `shellEnv` as `KEY=value` overrides. It
  never falls back to the server's machine, and the client contributes nothing.
- **dotfiles' `todos/ssh-agent.md`** (2026-10-21) found that *"any process that can reach
  [an agent's] socket can sign with it, so a pi session can `git push` or SSH to the
  steamdeck or mini-nas without anyone noticing"*. Will's requirement then: *"I must type
  my password and unlock the key for any new terminal session to connect to it."*
  Passing a pane's `SSH_AUTH_SOCK` to tools gives the agent exactly what that ruled out.
  `modules/pi` already gives agents settings of their own: `GIT_CONFIG_GLOBAL`, pointing
  at `git/config-agent`.

Two lessons run through all of these:

1. **The client's environment doesn't cross to where the tools run.** The place's own
   environment is read there.
2. **Filtering variables isn't isolation; a sandbox is.**

## The contract, proposed

An environment is **where and how a conversation's tools run**. It has ten parts. Each
part has one source, decided by the conversation and the daemon's configuration, never
by the pane that attached last.

| # | Part | What it is | What the contract says |
|---|---|---|---|
| 1 | **Place** | the pier, so the machine and user, the tools run as | the pier that owns the conversation (model A); later, a named environment (model C) |
| 2 | **Working directory** | where commands start and relative paths resolve; also where AGENTS.md and skills are found | one absolute path on the place, which must exist |
| 3 | **Base variables** | what any program needs to run | a fixed list from the place, never from a pane: `HOME USER LOGNAME SHELL PATH LANG LC_* TZ TMPDIR`, Nix's `LOCALE_ARCHIVE NIX_PATH NIX_PROFILES TERMINFO_DIRS XDG_DATA_DIRS XDG_CONFIG_DIRS`, and `TERM=dumb` |
| 4 | **Project variables** | what the project's toolchain sets | direnv's (devenv's) export in the working directory, evaluated on the place |
| 5 | **Agent settings** | variables pier sets for every tool, on purpose | from the daemon's configuration, in Nix: `GIT_CONFIG_GLOBAL`, `PAGER=cat`, `GIT_PAGER=cat`, and the like |
| 6 | **Credentials** | what lets a tool act as Will elsewhere: an SSH agent, `GH_TOKEN`, API keys | none by default; each one granted by name, by Will |
| 7 | **Shell** | the interpreter of `bash` calls | bash, non-login, non-interactive, as now |
| 8 | **Limits** | how long, and how much | a call's timeout, output windows; later the service's cgroup |
| 9 | **Reach** | files, network, processes, devices | today, everything the user can reach. Named so that isolation has a place to go |
| 10 | **The call's identity** | what a tool can know of where it runs | the conversation's number, as `PIER_CONVERSATION` (proposal) |

**Outside the contract, and so kept from tools:**
- the pane's terminal: `TMUX`, `TMUX_PANE`, `ALACRITTY_*`, `WINDOWID`, `TERM_PROGRAM`;
- the desktop session: `DISPLAY`, `WAYLAND_DISPLAY`, `SWAYSOCK`, `I3SOCK`,
  `DBUS_SESSION_BUS_ADDRESS`, `XDG_SESSION_*`;
- the shell's state: `PWD`, `SHLVL`, `_`, prompt variables;
- whatever was exported by hand in the pane;
- any credential not granted.

"Kept from" means the command starts with `inheritEnv: false` and only the contract's
variables. That's an allowlist, not a denylist. A denylist (Codex's `*TOKEN*`, Claude
Code's scrub) misses `NPM_AUTH`, and anything new.

**No promise about reach until isolation is built.** Variables aren't a boundary. A tool
runs as Will, so it can still read `~/.ssh` and `~/.config/gh/hosts.yml`, or connect to
the keyring's agent at `/run/user/1001/gcr/ssh` by its path. `/run/user/1001` is 0700,
but that keeps out other users, not Will's own processes. Leaving `SSH_AUTH_SOCK` out
stops accidental use, not a determined one. Stopping that takes a sandbox: Gondolin, or
a user namespace with a private home and `/run/user`. That's where Will's *"more
isolated run environments"* (2026-11-17) fits.

## How each part could be provided

Parts 1, 7 and 10 have one answer. The others:

**2. Working directory.** It's set once, when the conversation is created: from the
pane's directory for a local pane, and from `--cwd` or a menu of the remote's recent
directories for a remote one (`todos/remote.md`, component 4). The daemon checks it
exists on the place. A `/cd` could come later, as in p2.

**3. Base variables.** Options:
- a. **The daemon's own environment, filtered to the list.** Cheap, but it's whatever
  systemd's user manager had when it started: thin, and dated.
- b. **A login shell on the place, read once and filtered to the list.** That's
  `bash -lc env` from an empty environment, as dev containers' `userEnvProbe` and Zed do.
  It gives what a fresh terminal gets from `/etc/profile` and home-manager: the profile's
  `PATH`, `LOCALE_ARCHIVE`, `NIX_PATH`. On thenixbeast it took no measurable time, and
  gave 48 variables before filtering (2026-11-24).
- c. **Set in Nix,** on the service, as its `PATH` is today.

Proposal: b, read again whenever the daemon starts.

**4. Project variables.** Options:
- a. **The daemon runs direnv in the working directory** (`direnv export json`) and lays
  the result over the base.
  - In pier's own worktree, once evaluated, it took 0.14 s and gave 17 variables:
    `PATH`, `DEVENV_*`, `NIX_CFLAGS_COMPILE`, … (2026-11-24).
  - A first evaluation, or one after `devenv.nix` changes, builds the shell, which can
    take minutes.
  - Only an `.envrc` that's been allowed runs. direnv's trust is per user and machine.
- b. **`direnv exec <dir>` around every call.** Always current, but every call pays for
  the export.
- c. **None.** The model runs `devenv shell -- …` itself. Nothing hidden, but every
  command is longer, and the model has to know to do it.
- d. **From the pane,** as today. Only right while a local pane in that project is
  attached.

Proposal: a. Evaluate when the conversation is created, and again when one of direnv's
watched files changes (`DIRENV_WATCHES` lists them), so a call never waits for a build.
A project that isn't allowed gets no project variables, and the prompt says so.

**5. Agent settings.** A list in the service's configuration, written by Nix, as
`GIT_CONFIG_GLOBAL` is today. One list for every conversation.

**6. Credentials.** The hard part, as `todos/ssh-agent.md` found. Options:
- a. **None.** Tools can't push, SSH or call GitHub. Safe, but it breaks `git push` and
  `gh`.
- b. **Granted by name in pier's configuration:** variables such as `GH_TOKEN` or
  `SSH_AUTH_SOCK`, passed from the daemon's own environment to every conversation.
  Explicit and reviewable in Nix, but always on.
- c. **Granted per conversation by Will,** from a pane (`/grant ssh-agent`), stored with
  the conversation, revocable. Finer-grained, and more to build.
- d. **Credentials made for agents:** an SSH key authorized only where agents may go, and
  a GitHub fine-grained token for the repositories they work on, passed by name as in b.
  `modules/distributed_builders` does this for Nix's builders, and `todos/ssh-agent.md`
  floated it for pi-web.
- e. **Approval at use:** an SSH agent that asks Will before each new client, as
  1Password's does (`todos/ssh-agent.md`). But 1Password tells callers apart by process
  tree, and every tool descends from the one daemon, so all tools would count as one
  application.

Proposal: d through b now, and c later if daily use asks for it. Will's own key stays
out of tools.

**8. Limits.** Durable's bash has no default timeout; the model sets one or doesn't. A
default could be set in `prepare`. Later, cgroup limits (`MemoryMax`, `TasksMax`) on the
service cover the daemon and its tools together. Out of scope beyond naming them.

**9. Reach.** Out of scope here; named so the contract has a place for it. The options,
when it's taken up:
- systemd's sandboxing for each call (`systemd-run --user` with `ProtectHome=`,
  `PrivateNetwork=`);
- a user namespace (`bwrap`, as Claude Code's sandbox uses);
- Gondolin's VMs through pi-env (p3's slice 8).

Parts 2 to 6 stay the same under any of them.

## What it changes

- **Local panes.** A pane's environment no longer reaches tools: not a `nix shell` in
  the pane, not an `export` before `pier`, not a forwarded agent. Something a pane used
  to pass on becomes a project variable (put it in `.envrc`), an agent setting (Nix), or
  a granted credential. That's Will's call: it reverses 2026-10-29.
- **Remote panes need nothing special.** A conversation started from the deck gets the
  environment one started on thenixbeast in that directory would get. `attach` stops
  sending `env`, which removes the hazard in `todos/remote.md`, component 4.
- **The code:**
  - `pier.client-env` goes.
  - The Harness's `env` callback builds `NodeExecutionEnv({ cwd, shellEnv })` from the
    contract.
  - Bash's `prepare` sets `inheritEnv: false`, so `process.env` doesn't leak in. `read`,
    `write` and `edit` take no environment.
  - The contract, the probe and direnv's evaluation could be a layer extension
    (`src/layer/`), since p3's environments need the same. The rest is the daemon's.
- **Claude Code's own environment** stays the daemon's (pi-claude-code's
  `claudeEnvironment`). It's the provider's, not a tool's, so it's outside the contract.
- **To check by running, not yet done:**
  - whether `inheritEnv: false` with the base list breaks commands that need something
    else;
  - whether direnv's export, run by the daemon without a terminal, gives what it gives
    in a pane;
  - whether the login-shell read gives the same on the steamdeck, as `willy`.

## Open questions for Will

1. **The contract.** Do the ten parts cover what you mean by an environment? Is anything
   missing, or there that shouldn't be?
2. **Panes stop passing their environment, local panes too?** It reverses 2026-10-29.
3. **Base variables:** read from a login shell on the place (3b)?
4. **Project variables:** direnv, evaluated by the daemon in the working directory (4a)?
5. **Credentials:** none of your own, and credentials made for agents, named in Nix (6d
   through 6b)? What do agents need today: `git push` over SSH, `gh`, anything else?

## Done when

Every conversation's tools run with exactly the contract's parts, local and remote, and
a test shows a variable set only in a pane doesn't reach a tool. Then the contract goes
in `README.md`, `docs/history.md` records the reversal of 2026-10-29, and this file is
deleted.
