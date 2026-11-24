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

Everything below is Claude's proposal until Will agrees, except what's under "Decided".

## Decided

Will, 2026-11-24, on the first draft:

- **Panes stop passing their whole environment:** *"Yes, panes should stop passing
  their whole environment."* This reverses 2026-10-29, for local panes as well as
  remote ones.
- **An allowlist:** *"Allowlist is a good principle."*
- **The contract's parts:** *"This seems like a fairly cogent definition. I think these
  parts may be able to group themselves together some - which would provide conceptual
  components of abstraction, potentially useful in code & documentation."* Grouped in
  "The contract, grouped", below.
- **Credentials:** *"Beginning to stratify my credentials is a very good idea. The other
  major one is SSH access to other machines (e.g. `vulcanus` in the
  ~/repositories/vulcanus-proxmox repo). And perhaps the occasional need to run
  something as root (e.g. `nh os switch .`) to apply/debug the present machine."*
- **Portability:** *"We'll want to clarify/consolidate the lines between "the service"
  and "the pier daemon". Ideally we build something that is portable to non-Nix
  systems."*
- **The checks:** *"run your checks - though we'll need to leave out the steamdeck for
  now (as it's offline)."* Run 2026-11-24; see "Checked by running".

His questions that day, answered below: how bound an environment is to a conversation
(a), whether a conversation can change directories (b), whether direnv and devenv suit
an LLM's shell (c), the line between the service and the daemon (d), what the contract
leaves out (e), and where else base variables could come from (3).

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

## Checked by running (2026-11-24, thenixbeast)

Two scripts, kept outside the repo (`/tmp/pier-remote-research/checks/`), ran each
command the way a tool call would: through Durable 1.6.0's own `NodeExecutionEnv`, with
`inheritEnv: false` and only the contract's variables. They ran in a transient systemd
user unit, outside any terminal, as the daemon is. Three projects: pier's worktree,
`vulcanus-proxmox`, `dotfiles`. The steamdeck was offline, so nothing was run as `willy`.

**What works:**

- **Base variables from a login shell:** `bash -lc env` from an empty environment, 3
  ms, 48 variables. The list kept 22. The login shell has to be named by its absolute
  path (`getent passwd`, `/run/current-system/sw/bin/bash`): an empty environment has
  no `PATH` to find `bash` with, and the first run failed on exactly that. Fish, Will's
  interactive shell, gives the same `PATH` as bash's login profile.
- **Project variables from direnv, run by the daemon:** in all three projects. pier's
  took 3.5 s on the first run, then 0.13 s; vulcanus-proxmox's took 25.7 s on the first
  run, then 0.14 s. A tool then saw 108 variables in pier's and dotfiles' (137 in
  vulcanus-proxmox's), against 130 or more when the daemon's environment is inherited,
  and 155 in a pane.
- **Ordinary work under the contract:** `git` (with `config-agent`, as the service sets
  it), `nix`, a UTF-8 file name, Perl with no locale warnings.
- **What's kept out:** a variable set only in the daemon's process (standing in for a
  pane's), `SSH_AUTH_SOCK`, and `WAYLAND_DISPLAY`/`DISPLAY`/D-Bus/`SWAYSOCK`.
- **The checks can fail:** run as pier runs today (`inheritEnv: true`), the three
  keep-out checks fail: the daemon's variable leaks, and so do the agent's socket and
  the display. The first try at this control was itself vacuous (a flipped boolean ran
  the contract twice, and everything passed); caught because it passed, and fixed.

**Findings that change the design:**

- **`inheritEnv: false` drops `shellEnv` too.** Durable's `getShellEnv` returns only
  the call's own `env` when `inheritEnv` is false (`env/node.ts`, 1.6.0). So the
  contract's variables must go in each call's `env`, which bash's `prepare` hook sets.
  `NodeExecutionEnv({ shellEnv })` with `inheritEnv: false` left a command with no
  `PATH` at all (`git`: not found). Worth raising upstream later (`todos/upstream.md` is
  on hold): an option meaning "`shellEnv`, but not `process.env`".
- **direnv's export is a diff against what it's given.** Given the 22 filtered
  variables, it returned 83, among them the desktop profile's (`GTK_PATH`, `QT_*`,
  `XCURSOR_PATH`, `SSH_ASKPASS`, `EDITOR`, `PAGER`): devenv's shell re-adds whatever
  its own hooks and `/etc/profile` set. Given the whole login environment, it returned
  60, and none of those. So the project's part is only clean when computed against the
  full login environment, and then filtered.
- **A project's `.env` becomes project variables.** vulcanus-proxmox's devenv has
  `dotenv.enable = true`, so direnv exports its `.env`: `PROXMOX_API_PASSWORD`,
  `GMAIL_PASSWORD`, `PM_PASS`, `TF_VAR_proxmox_api_token_secret`, `TF_VAR_github_token`,
  `PUSHOVER_TOKEN` and more, alongside `KUBECONFIG` and `TALOSCONFIG`. "Project
  variables" can be credentials. A pane in that project passes them on today too.
- **Authority a tool still has, without any variable:**
  - SSH to GitHub with the contract's variables only: refused (`Permission denied
    (publickey)`). The key file needs a passphrase, and no agent was named.
  - The same, naming the keyring's socket by its path (`/run/user/1001/gcr/ssh`): it
    hung until the 20 s timeout, presumably the keyring asking on the desktop for the
    passphrase. So the socket is reachable by path, and its behaviour depends on
    whether the key is unlocked. Not investigated further.
  - `sudo -n` and `run0 --no-ask-password`: both refused, needing a password. Will is
    in `wheel`, and `wheelNeedsPassword` is true.
  - A pane's environment is readable from `/proc/<pid>/environ` by any process of
    Will's: 68 variables of a fish shell were read from the transient unit.
  - The tmux server, by its socket's path, `/run/user/1001/tmux-1001/default`: reachable.
    A tool could type into any pane. Leaving `TMUX` out only stops the accidental use.

## The contract, grouped

Will asked (2026-11-24) for the parts to group into components. Four groups, each a
question with one owner. Everything here is Claude's proposal.

| Group | Its question | Parts | Who provides it |
|---|---|---|---|
| **Place** | where do the tools run? | machine and user; working directory; reach | the conversation (`pi.agent`'s `cwd`), the pier that owns it; later an isolation backend |
| **Variables** | what's in the process's environment? | base, project, agent settings, the call's identity | the place's login profile, the project's toolchain, pier's configuration, pier |
| **Credentials** | as whom can a tool act elsewhere? | SSH, tokens, root | Will, per credential (below) |
| **Execution** | how does a call run? | shell, limits, stdin, terminal, umask, process group | pier's configuration, Durable's defaults |

In code, this suggests one value per conversation, built fresh for each call:

```ts
interface ToolEnvironment {
  place: { cwd: string };               // later: which backend (local, pi-env, Gondolin)
  variables: Record<string, string>;     // base, project, settings, identity: later wins
  credentials: readonly CredentialGrant[];
  execution: { shell: string; timeoutSeconds?: number };
}
```

`variables` is what bash's `prepare` puts in a call's `env`, with `inheritEnv: false`.
The groups are also the README's headings when it lands.

| # | Part | Group | What the contract says |
|---|---|---|---|
| 1 | **Machine and user** | Place | the pier that owns the conversation (model A); later, a named environment (model C) |
| 2 | **Working directory** | Place | one absolute path on the place, which must exist; changed only through pier (question b) |
| 3 | **Reach** | Place | today, everything the user can reach. Named so isolation has a place to go |
| 4 | **Base variables** | Variables | the place's login profile, filtered to a fixed list ("How each part is provided") |
| 5 | **Project variables** | Variables | the project's toolchain, evaluated on the place (question c) |
| 6 | **Agent settings** | Variables | from pier's configuration: `GIT_CONFIG_GLOBAL`, `PAGER=cat`, `GIT_PAGER=cat`, … |
| 7 | **The call's identity** | Variables | `PIER=1` and the conversation's name, `PIER_CONVERSATION=thenixbeast#3` (proposal) |
| 8 | **Credentials** | Credentials | none by default; each granted by name, in tiers ("How each part is provided") |
| 9 | **Shell** | Execution | bash, non-login, non-interactive, as now |
| 10 | **Limits** | Execution | a call's timeout, output windows; later the service's cgroup |
| 11 | **Standard input, terminal** | Execution | none: stdin closed, no TTY (Durable's; checked, `tty` says "not a tty") |

**Outside the contract, and so kept from tools:**
- the pane's terminal: `TMUX`, `TMUX_PANE`, `ALACRITTY_*`, `WINDOWID`, `TERM_PROGRAM`;
- the desktop session: `DISPLAY`, `WAYLAND_DISPLAY`, `SWAYSOCK`, `I3SOCK`,
  `DBUS_SESSION_BUS_ADDRESS`, `XDG_SESSION_*`;
- the shell's state: `PWD`, `SHLVL`, `_`, prompt variables;
- whatever was exported by hand in the pane;
- any credential not granted.

"Kept from" means the command starts with `inheritEnv: false` and only the contract's
variables. That's an allowlist, not a denylist (decided). A denylist (Codex's `*TOKEN*`,
Claude Code's scrub) misses `NPM_AUTH`, and anything new.

**No promise about reach until isolation is built.** Variables aren't a boundary, as the
checks showed. A tool runs as Will, so it can read `~/.ssh` and `~/.config/gh/hosts.yml`,
connect to the keyring's agent or the tmux server by their paths, and read a pane's
environment from `/proc`. `/run/user/1001` is 0700, but that keeps out other users, not
Will's own processes. Leaving `SSH_AUTH_SOCK` and `TMUX` out stops accidental use, not a
determined one. Stopping that takes a sandbox: a user namespace with a private home,
`/run/user` and `/proc`, or Gondolin. That's where Will's *"more isolated run
environments"* (2026-11-17) fits.

## Will's questions (2026-11-24)

### a. How bound together are an environment and a conversation?

Loosely, by design in Durable, and tightly in what the model believes.

- **In Durable, an environment is built fresh for every tool call.** The Harness's `env`
  callback gets the conversation's id, its `cwd` and its documents, and returns an
  `ExecutionEnv`. Nothing is kept between calls (README, "Environment": "a fresh
  environment object per call is fine"). So the binding is whatever pier stores in the
  conversation and reads back in that callback: today `pi.agent`'s `cwd` and
  `pier.client-env`.
- **`cwd` lives in `pi.agent`, which is rewindable and forks "as of".** A fork gets the
  directory its parent had at the fork point, and a child conversation (a subagent)
  starts with a copy of its owner's.
- **The model's beliefs bind it tighter.** The directory is in the system prompt (pier's
  `cwd` section, `src/layer/prompt.ts`), AGENTS.md and skills are read from it, and
  Claude Code is started in it and tells the model so (`ConversationDirectories`). The
  transcript is full of paths and command output from that place. Move a conversation to
  another place and the model's context no longer matches the machine. That's why model B
  (hand-off) was set aside, and why model C keeps the place a property of the
  conversation rather than of a call.
- **Proposal:** the conversation holds a reference to its environment (its place and
  working directory), not the environment itself. Variables and credentials are
  computed for each call from that reference and pier's configuration, so changing
  `.envrc`, Nix or a grant reaches the next call without touching the conversation. The
  conversation stores only what someone chose: its directory, and later its grants.

### b. Can a conversation change working directories?

Yes, and Durable supports it: `Conversation.configure({ cwd })` changes `pi.agent` in one
commit. Its README: "the environment is built from the current `cwd` at each use, so a
`cwd` … change can reach calls the model already made." A change applies to the prompt
from the next request. Three things follow:

- **The prompt's `cwd` section** changes, and is sent again: one new positional system
  entry, which costs a little of the prompt cache, once.
- **AGENTS.md and skills** are read again from the new directory, as pier reads them
  before every request (`prompt.ts`, `skills.ts`).
- **Claude Code's warm process** was started in the old directory. pi-claude-code
  includes the `cwd` in each warm process's fingerprint (`claude-cli.ts`, `launchPlan`),
  so a new directory starts a new process, which then reads the conversation from the
  prompt cache (as switching to a fork does). Not checked by running.

A `cd` inside one bash call doesn't change it: each call starts in the conversation's
directory, as now. Options for how it changes:

- a. **Only from a pane:** `/cd <dir>` in the TUI, as p2's `/cd` ("Relocate"). Will
  decides; the model is told by the changed prompt section.
- b. **A tool the model may call** (`change_directory`), so it can move to a worktree it
  just made. It also moves AGENTS.md and the skills, so it's a real change of context.
- c. **Not at all:** a new directory means a new conversation (`/new` there), as today.

Proposal: a now, as a small command; b if daily use asks (worktrees are the likely
case). Either way the directory must exist on the place, and a remote pane's `/cd`
names a path on the far machine.

### c. direnv and devenv for an LLM's shell

They work, but they're built for a person in a terminal. What the checks showed:

- **Good:** the agent gets exactly the project's toolchain, from one source of truth
  that Will maintains anyway. direnv's `allow` is a trust gate that a cloned repository
  can't bypass. Once evaluated, it's fast (0.13 to 0.14 s), and caching per
  conversation removes even that.
- **Bad:**
  - **A first evaluation is slow** (3.5 s and 25.7 s here, minutes after a change to
    `devenv.nix` that needs a build). Run before a tool call, it stalls the model; run in
    the background, the first calls get stale or no project variables.
  - **Its output is a diff against what it's given** (above), so pier must give it the
    whole login environment, then filter.
  - **It mixes credentials in** (vulcanus-proxmox's `.env`), and **desktop noise**
    (devenv's shell re-adds `GTK_PATH`, `QT_*`).
  - **It's two tools stacked:** direnv's `.envrc` calls devenv's `direnvrc`. devenv 2.0
    now offers its own activation (`devenv shell`, `devenv hook`) without direnv
    (devenv.sh, "Direnv", read 2026-11-24).
  - **The model doesn't know it's there**, unless the prompt says so.

Alternatives, for how a project's toolchain reaches a tool:

| Option | How | For | Against |
|---|---|---|---|
| a. **direnv, evaluated by the daemon** (the first proposal) | `direnv export json` in the directory, cached, over the base | Works with every project Will has; honours `direnv allow` | Diff semantics, slow first run, mixes in `.env` |
| b. **devenv directly, evaluated by the daemon** | devenv's own environment (`devenv shell -- env`, or devenv's `print-dev-env` analogue), cached | One tool, not two; devenv's own cache | Nix and devenv only; skips `.envrc`'s other lines; no `allow` gate unless pier keeps one |
| c. **Wrap each command** | `devenv shell -- bash -c '<command>'`, or `direnv exec <dir>` | Always current; nothing cached | Every call pays (0.13 s once warm, much more cold); noisy output |
| d. **A hook per command, as mise does for agents** | the shell sources a line before each command (`eval "$(direnv export bash)"`), as mise's `hook-env` with Claude Code's `CLAUDE_ENV_FILE` (mise.jdx.dev/agents.html) | Follows a `cd` within the conversation; cheap when nothing changed | Runs project code in every call; harder to keep to the allowlist |
| e. **None: the model runs the project's tools itself** | `devenv shell -- npm test`, guided by AGENTS.md | Nothing hidden; the model sees exactly what runs | Every command longer; the model forgets; slow per call |
| f. **Language-level environments** (mise, asdf, a venv) | the project's own tool manager | Portable beyond Nix | Not Will's convention; still needs one of a–e to reach the shell |

Proposal: a, with three changes the checks call for:

- give direnv the whole login environment, and keep only what it changes;
- evaluate in the background when a conversation is created or a watched file changes,
  and tell the model in its prompt while the project's environment isn't ready, or
  wasn't allowed;
- keep the names a project's `.env` defines out of a tool's variables unless they're
  granted for that project ("Credentials, in tiers"). pier reads the names from the
  `.env` file itself, as the check did.

The last is a tension with the allowlist: a toolchain's variables are an open set
(devenv exported 83 to 112 here), so they can't be listed in advance. The proposal
trusts what direnv's toolchain sets, and lists only the secrets. The stricter
alternative is an allowlist of patterns for project variables too (`PATH`, `DEVENV_*`,
`NIX_*`, `PKG_CONFIG*`, `PYTHON*`, `CC`, …), widened as projects need. Will's call.

The interface is "a source of project variables for a directory", so b or f can stand
beside it later. On a machine without Nix, direnv alone still covers projects with an
`.envrc`.

### d. The service and the daemon

Today the line is blurred: the daemon's behaviour depends on what the Nix unit puts in
its environment.

| What | Set by today | Used by |
|---|---|---|
| `PATH`, `GIT_CONFIG_GLOBAL` | the unit (dotfiles' `pier.nix`) | the daemon, Claude Code, and every tool (inherited) |
| `PI_CLAUDE_CODE_COMMAND` | the unit | pi-claude-code |
| `PIER_SKILLS` | the unit | the daemon's skills extension |
| `PIER_MODEL`, `PIER_THINKING`, `PIER_SOCKET`, `PIER_STATE_DIR` | optional, the environment | the daemon |
| `KillMode=control-group`, `X-SwitchMethod=keep-old`, `Restart=on-failure` | the unit | systemd |
| `HOME`, `XDG_RUNTIME_DIR`, the desktop's variables | systemd's user manager | the daemon, and every tool |

Proposal, to draw the line:

- **The daemon owns its configuration**, in a file of its own:
  `$XDG_CONFIG_HOME/pier/config.json` (or TOML), read at start. It holds the model, the
  skills directories, agent settings, credential grants, the base
  variables' list, and the timeout. Environment variables (`PIER_*`) stay as overrides.
  The daemon logs what it read, as it does `PIER_SKILLS` now.
- **The service manager owns only supervision:** start at login, restart on failure,
  kill the control group, don't restart on switch. A systemd unit on Linux, launchd on
  macOS later, or a foreground `pier daemon` anywhere.
- **The daemon's own environment stops reaching tools,** which this contract already
  does: tools get the contract's variables, never `process.env`. So the unit's `PATH`
  only serves the daemon and Claude Code.
- **Nix writes the config file,** as home-manager writes any program's (a module option
  per setting, rendered to `config.json`). A non-Nix user writes the file by hand, or
  `pier init` writes a commented one. pier ships a plain `pier.service` too, for
  distributions without Nix.
- **Nothing Nix-specific in the daemon:** the base variables' probe uses the user's
  login shell (`getent passwd`), not Nix paths; the list keeps Nix's variables only
  when they exist.

It's host code, thrown away with the daemon when p3 takes over (`docs/vision.md`), but
the module and the config file are what carry over as "Will's Nix module".

### e. What the contract leaves out

On purpose, and kept from tools:

- the pane's terminal, the desktop session, and the shell's state (above);
- **the client's machine**: nothing of a remote pane reaches tools, not even its
  directory (`todos/remote.md`);
- **anything interactive**: no TTY, no stdin, so no password prompts, editors or pagers
  (`sudo` and `run0` refuse without one, as checked).

Not covered yet, so outside any promise:

- **reach** (files, network, processes, devices), until isolation is built;
- **Claude Code's own environment**, which is the provider's (pi-claude-code passes the
  daemon's, minus `ANTHROPIC_API_KEY`);
- **long-running processes a tool starts** (a dev server in the background): they
  outlive the call in their own process group, keep the variables they started with,
  and die only with the service's control group;
- **file permissions** (umask, ownership) and **resource limits** beyond a timeout: the
  daemon's;
- **what pier's own extensions read** for the prompt (AGENTS.md, skills): read by the
  daemon, not through the environment, but from the place's directory;
- **time zone and locale**, beyond what the login profile sets.

## How each part is provided

**Working directory.** Set when the conversation is created: from the pane's directory
for a local pane, and from `--cwd` or a menu of the remote's recent directories for a
remote one (`todos/remote.md`, component 4). The daemon checks it exists on the place.
Changed afterwards only through pier (above, b).

**Base variables (Will's question 3: where else could they come from?).** Every option,
with what it gives on thenixbeast:

| Option | Gives | For | Against |
|---|---|---|---|
| a. **The daemon's own process** | systemd's user manager's environment, plus the unit's (53 variables) | Nothing to run | Whatever the manager had when it started: the desktop's variables, a dated `PATH`; differs between a login at the desktop and a lingering manager |
| b. **The user's login shell, probed** (proposal) | `/etc/profile`, home-manager's session variables (48 variables, 3 ms) | What any new terminal gets; Zed and dev containers do this; works on non-Nix systems | Runs the user's profile, so a slow or noisy one slows the daemon's start; read once |
| c. **systemd's `environment.d`** (`systemctl --user show-environment`, `~/.config/environment.d/`) | the user manager's environment, which home-manager feeds (`10-home-manager.conf`: Qt, locale, XDG dirs) | No shell to run | Not the profile `PATH`; systemd-only |
| d. **PAM's environment** (`/etc/environment`, `pam_env`) | system-wide variables | Standard | Thin: no user profile |
| e. **pier's configuration** (a fixed map in `config.json`, written by Nix) | exactly what's written | Fully explicit, reproducible | Must be kept in step with the system by hand, or by Nix |
| f. **A minimal default** (`PATH=/usr/bin:/bin`, `HOME`, `USER`, `LANG=C.UTF-8`) | almost nothing | Predictable, portable | Breaks on NixOS, where nothing is in `/usr/bin` |

Proposal: b, filtered to the list, with e laid over it for anything Will wants to pin.
The probe runs at the daemon's start with the user's login shell by absolute path.

**Project variables.** Above, c: direnv evaluated by the daemon, diffed against the full
login environment, credentials filtered out unless granted, cached per directory.

**Agent settings and the call's identity.** In pier's configuration (d). Today's are
`GIT_CONFIG_GLOBAL`; to add, `PAGER=cat`, `GIT_PAGER=cat`, `PIER=1`,
`PIER_CONVERSATION`.

**Credentials, in tiers** (Will: *"Beginning to stratify my credentials is a very good
idea"*). What agents need, from Will and the checks:

| Need | Today | Tier |
|---|---|---|
| Read anything public (web, packages) | no credential | 0: none |
| `git push` and `gh` on Will's GitHub repositories | Will's SSH key through an agent; `gh`'s token in `~/.config/gh/hosts.yml` | 1: project |
| A project's API tokens (Proxmox, Terraform, Pushover in vulcanus-proxmox's `.env`) | the project's `.env`, through direnv | 1: project |
| Will's own services (Todoist, Calendar through `gog`, ketch's backends) | their CLIs' config files in `~/.config` | 1: Will's tools |
| SSH to other machines (vulcanus, mini-nas, the Proxmox and PBS hosts as `root`, Ansible's `ansible_user: root`) | Will's key, from an agent he unlocks per terminal (`todos/ssh-agent.md`, and vulcanus-proxmox's `CLAUDE.md`: `eval (ssh-agent -c) && ssh-add`) | 2: infrastructure |
| Root on this machine (`nh os switch .`, debugging) | `sudo` with Will's password (`wheelNeedsPassword`) | 3: root here |

Options for each tier:

- **Tier 1, project and tools.** Allowed by name in pier's configuration, per project or
  for all (a `GH_TOKEN` for a fine-grained token made for agents; a project's `.env`
  names allowed for that directory). The tools' own config files stay readable, since
  reach isn't enforced yet.
- **Tier 2, infrastructure: SSH.** Options:
  - a. **An agent key of its own**, made for agents, authorized only on the machines
    agents may reach (vulcanus, mini-nas), and only as the users they may be. Offered
    through an `ssh-agent` the daemon starts, holding only that key. Dotfiles'
    `distributed_builders` precedent.
  - b. **Will's key, through a socket granted per conversation** (`/grant ssh`, until
    the conversation ends or a time limit), from an agent Will unlocks. OpenSSH's
    `ssh-add -t` limits a key's lifetime, and `ssh-add -h` limits which hosts it may
    be used for (destination constraints, OpenSSH 8.9 and later).
  - c. **Approval at use**, as 1Password's agent asks (`todos/ssh-agent.md`). Tools all
    descend from one daemon, so 1Password would see one application.
  - d. **Not at all:** the agent writes the command, and Will runs it in a pane.

  Proposal: a for the routine machines, with destination constraints (`ssh-add -h`) as
  a second guard; b for occasional, wider access; never Will's own agent socket by
  default.
- **Tier 3, root here.** Options:
  - a. **Not at all** (today's effect: `sudo` needs a password, and there's no TTY).
    The agent prepares; Will runs `nh os switch .` himself.
  - b. **A narrow sudo rule for an agent-only command,** with `NOPASSWD` for exactly
    `nh os switch` (or `nixos-rebuild switch`) of a fixed flake path. Anything else
    still needs Will. A rule like that gives the agent root through whatever that flake
    contains, which the agent can edit: it's root in all but name.
  - c. **Approval at use:** polkit's `run0` asks on the desktop (it refused without
    interactive authentication, as checked); a tool would wait for Will to approve. With
    Durable 1.6.0's tools that park, a tool can wait for a signal, so a pier tool could
    ask Will in the TUI and wait.
  - d. **Build and test without root:** `nh os build`, `nixos-rebuild build-vm`, and
    `nix eval` need none; only activation does.

  Proposal: d for routine work, a for activation now, c (asking in the TUI) later if
  daily use asks. Not b: an agent that can edit the flake it may switch to has root.

**Limits.** Durable's bash has no default timeout; the model sets one or doesn't. A
default could be set in `prepare`. Later, cgroup limits (`MemoryMax`, `TasksMax`) on the
service cover the daemon and its tools together. Out of scope beyond naming them.

**Reach.** Out of scope here; named so the contract has a place for it. The options,
when it's taken up:
- systemd's sandboxing for each call (`systemd-run --user` with `ProtectHome=`,
  `PrivateNetwork=`);
- a user namespace (`bwrap`, as Claude Code's sandbox uses), with private `/proc`,
  `/run/user` and home;
- Gondolin's VMs through pi-env (p3's slice 8).

The Variables and Credentials groups stay the same under any of them.

## What it changes

- **Local panes.** A pane's environment no longer reaches tools: not a `nix shell` in
  the pane, not an `export` before `pier`, not a forwarded agent. Something a pane used
  to pass on becomes a project variable (put it in `.envrc`), an agent setting (Nix), or
  a granted credential. That's Will's call: it reverses 2026-10-29.
- **Remote panes need nothing special.** A conversation started from the deck gets the
  environment one started on thenixbeast in that directory would get. `attach` stops
  sending `env`, which removes the hazard in `todos/remote.md`, component 4.
- **The code:**
  - `pier.client-env` goes, and `attach` stops sending `env`.
  - Bash's `prepare` sets each call's `env` to the contract's variables and
    `inheritEnv: false`. Not `NodeExecutionEnv`'s `shellEnv`, which `inheritEnv: false`
    drops (checked). `read`, `write` and `edit` take no environment.
  - The contract, the probe and direnv's evaluation could be a layer extension
    (`src/layer/`), since p3's environments need the same. The rest is the daemon's.
  - A test shows a variable in the daemon's process (and a pane's) doesn't reach a tool,
    and fails with `inheritEnv: true`, as the check did.
- **Claude Code's own environment** stays the daemon's (pi-claude-code's
  `claudeEnvironment`). It's the provider's, not a tool's, so it's outside the contract.
- **Not yet checked:** the steamdeck, as `willy` (offline); a conversation's `cwd`
  changed with `configure`, and Claude Code's warm process after it; how the keyring's
  agent behaves when a tool reaches it by path and the key is locked.

## Open questions for Will

1. **The groups:** Place, Variables, Credentials, Execution. Do they fit how you think of
   it?
2. **Changing directory (b):** `/cd` from a pane now, a tool for the model later?
3. **Project variables (c):** direnv evaluated by the daemon, diffed against the login
   environment, cached, with a project's `.env` names kept out unless granted? Or an
   allowlist of patterns for project variables too? Or another of the options?
4. **The service and the daemon (d):** a config file the daemon owns, Nix writing it,
   and the unit doing only supervision?
5. **Base variables (3):** the login shell, probed, with pinned values from the config
   file?
6. **Credentials:** an agent-only SSH key for the machines agents may reach (tier 2a),
   and no root, with Will running `nh os switch` himself (tier 3a and d)? Which machines,
   and as which users, should an agent key reach?
7. **Tier 1:** a GitHub token made for agents, and a project's `.env` passed only by the
   names allowed for that project?

## Done when

Every conversation's tools run with exactly the contract's parts, local and remote, and
a test shows a variable set only in a pane doesn't reach a tool. Then the contract goes
in `README.md`, `docs/history.md` records the reversal of 2026-10-29, and this file is
deleted.
