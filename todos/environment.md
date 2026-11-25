# The environment contract: what a conversation's tools run with

## Opening prompt

> Read `AGENTS.md`, `docs/principles.md`, then this spec's "Decided" and "Plan" (the
> rest is the evidence behind them: read the sections a step names). Build the plan's
> steps in order, on a branch in a worktree, each step its own commit or pull request
> with tests that fail without it. Will decided everything the plan needs on
> 2026-11-24; where a step needs a choice the spec doesn't settle, ask him rather than
> guess, and record his answer here, verbatim and dated. Check measurements again
> before relying on them (`experiments/environment/`, `experiments/cwd/`). When it's
> built, refresh `todos/remote.md` from it (Will: *"implementing the environment work,
> and then using that to refresh the remote.md spec - before beginning work on it"*).

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

Will, later on 2026-11-24, on the second draft:

- **The four groups** (Place, Variables, Credentials, Execution): *"Yes."*
- **Changing directory:** *"Yes, we need a `/cd` command. A tool to do the same could be
  very useful, but we may not want to grant it to every conversation - as it could let a
  model/conversation change its own directory and effectively work-around the
  environment constraints we've set up."*
- **Base variables:** *"Login shell sounds good as a base."*
- **Credentials:** *"I like your tiers. We can defer which specific machines & users
  when it comes to implementatiton."* And *"Yes to a `GitHub` token made for agents."*
- **Asked again**, answered below: why changing directory costs the prompt cache (b);
  why parts are not yet covered (e); what "a project's `.env` names kept out unless
  granted" means and how (c); whether a config file the daemon owns is best practice,
  and in something more human-editable than JSON (d).

Will, later still on 2026-11-24, on the third draft:

- **Measure `/cd` with real Claude:** *"Great, run it with real Claude so we know."* Run
  that day; see "Why changing directory costs the prompt cache".
- **A project's `.env`:** the axiom that a conversation pointed at a project may see its
  `.env`, and a credentials system, its principles first, for moving those secrets into
  stronger control later; and a skill or the like so the model knows its environment
  holds secrets. Quoted in full under question c; the credentials system is
  `todos/credentials.md`.
- **The configuration:** *"Great, let's go with a daemon-owned YAML config with schema
  checking."*

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

Two scripts, `experiments/environment/contract-check.mjs` and `authority-check.mjs` (each
says how to run it), ran each command the way a tool call would: through Durable 1.6.0's own `NodeExecutionEnv`, with
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
  - The same, naming the keyring's socket by its path (`/run/user/1001/gcr/ssh`): the
    first run hung until the 20 s timeout, presumably the keyring asking on the desktop
    for the passphrase. Run again later that day, it **succeeded** ("Hi DArtagan! You've
    successfully authenticated"), the key having been unlocked in between. So any tool
    can use Will's key by the socket's path whenever it's unlocked, with no variable at
    all. Only isolation (part 3, reach) or a different agent (credentials, tier 2)
    changes that.
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

### Why changing directory costs the prompt cache (Will's follow-up)

Anthropic's prompt cache matches a request's *prefix*: everything from the start of the
request up to a cache breakpoint must be byte-identical to a request it saw before. The
first byte that differs ends the match, and everything after it is read at full price
and written to the cache again. What a directory change touches, from the code
(pi-claude-code at `d5b5e04`, Durable 1.6.0, pier's layer):

- **pier's own `cwd` section.** pier puts the directory in the prompt as a section
  (`src/layer/prompt.ts`). Durable stores a changed section as a *new* system entry at
  the point of the change, in the transcript's order (README, "System Prompt": "only what
  changed is sent again"). So the earlier part of the conversation stays the same, and
  the cache still matches up to the change. The cost is the new entry itself, a few
  dozen tokens. That part is cheap.
- **AGENTS.md and skills.** The same: if the new directory has different ones, the
  changed sections are appended as new entries. A larger AGENTS.md is more tokens, still
  only from the change onward.
- **Claude Code's own environment block. This is the expensive one.** Claude Code tells
  the model its working directory in a system message near the *start* of the request
  (its "environment" message, with the date), not at the end. pi-claude-code records
  that message from the first request of a conversation and replays it unchanged after,
  so the prefix stays stable (`claude-cli.ts`, `deriveInitialSystemMessages` and
  `rewriteInitialRequest`; ARCHITECTURE.md: it "restores their stable layout during
  full-history replay"). It keeps the recorded copy as long as the conversation lasts.
  - If the recorded message is kept, the cache survives, but the model is told the old
    directory there, and the new one in pier's section. That's the disagreement pier's
    `ConversationDirectories` exists to avoid.
  - If it were replaced with the new directory, everything after the first system
    messages, the whole conversation, would be a cache miss once: a full re-read at full
    price, as after an hour idle.

**Measured with real Claude (2026-11-24, `experiments/cwd/run.ts`).** Four Opus turns
at low thinking, Claude Code 2.1.329: two in directory `alpha`, then
`configure({ cwd: bravo })`, then two in `bravo`. Each turn asked the model to quote
both the directory in its environment information and the one in pier's `<cwd>`
section, and the run caught each request body pi-claude-code sent upstream.

| Turn | Cached | Model's answer (environment / `<cwd>`) | Where `bravo` appears in the request |
|---|---|---|---|
| 1. alpha, cold | 64.2% | alpha / alpha | nowhere |
| 2. alpha, warm | 89.6% | alpha / alpha | nowhere |
| 3. bravo, just after the change | 69.9% | **alpha** / bravo | one new system message: `Updated system prompt section "cwd"` |
| 4. bravo, again | 91.4% | **alpha** / bravo | the same, and the model's last answer |

What that shows:

- **The prompt cache survives a change of directory.** Turn 3 read 1,546 tokens from the
  cache and wrote 664, close to turn 1's shape; turn 4 was back above 90%. pier's
  changed `<cwd>` section arrives as one new system message after the history, as
  Durable promises, so everything before it still matches. Nothing like a full re-read.
- **But Claude Code's environment message keeps the old directory.** In turns 3 and 4
  the request still began with "Primary working directory: …/alpha-directory", and the
  model quoted it. pi-claude-code replays the environment message it recorded on the
  conversation's first request, for the life of the conversation, even though a new
  Claude Code process was started in `bravo` (its `cwd` is in the process's
  fingerprint). Of the two outcomes guessed above, it's the first: cache kept, stale
  directory.
- **pier's `ConversationDirectories` workaround only covers a conversation's first
  directory.** It makes Claude Code *start* in the right place; pi-claude-code then pins
  what Claude Code said on that first start.
- **The model was told two directories, and when asked, reported both faithfully.** It
  didn't say which was right. A model that runs `pwd` would find `bravo` (tools run in
  the conversation's `cwd`), but one that trusts its environment block would write
  paths under `alpha`.

So a `/cd` that only calls `configure({ cwd })` costs almost nothing in cache, and leaves
the model told two directories. Will then asked (2026-11-24) for extensive testing, for
the question of reloading Claude Code on a change, and for how the environment line is
made and whether anything can be overridden. That's the next three sections.

### How Claude Code's environment block is made, and kept (2026-11-24)

Read from Claude Code 2.1.329's bundled JavaScript (`strings` of its binary; the
functions are minified, so the names below say what they do, not what they're called)
and pi-claude-code at `d5b5e04` (still its newest commit on 2026-11-24). Checked with
`experiments/cwd/env-block.ts`, which runs Claude Code against a stub API on loopback
and keeps the request bodies (no tokens spent).

- **Claude Code builds it from its own process**, on each run: the working directory is
  its process's `cwd`; then whether that's a git repository or worktree, the platform,
  the shell (with the login shell from `SHELL`), the OS version, two fixed safety notes,
  the model's name and ID, and today's date. It's sent as a system message right after
  the first user message, with a cache breakpoint on it.
- **In a worktree it says more:** that it's a worktree, not to `cd` to the repository's
  root, and to avoid a bare `git stash` (checked).
- **Claude Code has its own wording for a change mid-session.** Its interactive session
  notices a changed directory, date, worktree or scratchpad and sends an update rather
  than a new block: `# Environment update` / `Primary working directory: <new> (was
  <old>)`, and `The date has changed. Today's date is now <date>.` pier never sees these:
  each pi-claude-code request is a fresh `claude -p` run, which always sends the whole
  block.
- **pi-claude-code records the block once and replays it.** After a conversation's first
  request it stores Claude Code's system messages (environment and date) in the
  conversation, inside the answer's replay diagnostic (`claude-code.native-assistant.v1`,
  field `initialSystemMessages`). From then on it rewrites every request so those stored
  messages replace whatever Claude Code just generated (`rewriteInitialRequest`). That
  keeps the start of the request byte-identical, which is what keeps the prompt cache
  warm across runs, processes and restarts.
- **It drops the recording when the model changes, and only then.** Its `prepareMessages`
  strips replay diagnostics from answers by another model; with none left, the block
  Claude Code just made goes through, and is recorded afresh. Checked with real Claude
  (`experiments/cwd/model.ts`): after `/model` from Opus to Sonnet, the request carried
  "You are powered by the model named Sonnet 5.5". A change of directory has no such
  rule, so the old directory stays.
- **Claude Code is already restarted on a change of directory.** pi-claude-code's warm
  process is keyed by a fingerprint that includes the `cwd`, so a new directory gets a
  new Claude Code, started there (seen in every trial below: "started in alpha, alpha,
  bravo, bravo"). The new process does generate a block naming the new directory, and
  pi-claude-code replaces it with the recorded one. So reloading a Claude Code session
  already happens, and on its own changes nothing the model sees.
- **The date goes stale the same way, today, without any `/cd`.** In Will's live store
  (copied, read-only, 2026-11-24), 15 conversations recorded a block, and **498 of their
  1,746 answers were given under a recorded date that wasn't the day of the answer**.
  Conversation 4995 (Durable's id) ran from 2026-11-17 to 2026-11-24 and was told
  "Today's date is 2026-11-17" throughout. No conversation's recorded directory ever
  changed: none has had its `cwd` changed.
- **Claude Code's switches don't help** (checked with the stub):
  `--exclude-dynamic-system-prompt-sections` ("moves per-machine sections … into the
  first user message", but only with the default system prompt, and pi-claude-code
  passes its own) left the block unchanged; so did `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT=1`;
  `CLAUDE_CODE_HIDE_CWD` only hides the directory in Claude Code's own terminal header.

### What /cd does to the model (tested 2026-11-24)

`experiments/cwd/act.ts`, with real Claude Code (Opus 5.5, low thinking): in each trial
the model writes `marker.txt` "in the current project directory" in `alpha`, the
directory changes to `bravo`, it writes another "in the current project directory", then
says where it is. Three ways of handling the change:

- `bare`: `configure({ cwd })` alone (pier's `<cwd>` section is updated);
- `note`: and a note in Claude Code's own words, `# Environment update` /
  `Primary working directory: <bravo> (was <alpha>)`;
- `refresh`: and a `beforeRequest` hook that, when the recorded directory isn't the
  conversation's, strips the recording from the request, so pi-claude-code keeps the
  block Claude Code just made, and records that instead (as it does for a model change).

Twelve trials: one of each on a short conversation, then three of each after the model
had read a 60 KB file (about 23,000 tokens of history), so a re-read would show.

| Variant | Wrote in the right directory | Said it was in | Environment line afterwards | The change's first request, long history |
|---|---|---|---|---|
| bare | 4 of 4 | bravo | still alpha | read 23,432–23,466 from cache, wrote 206–221 |
| note | 4 of 4 | bravo | still alpha | read 23,430, wrote 313–316 |
| refresh | 4 of 4 | bravo | **bravo** | read 1,516, **wrote 22,126–22,139** |

What it shows:

- **The model followed the directory pier tells it in every trial, even with the stale
  line.** It used absolute paths under `bravo`, and several answers said the directory
  had changed. pier's `<cwd>` section, arriving after the history, won over the block
  near the start. In one trial it ran `pwd` to be sure.
- **A note costs about 100 tokens more than nothing**, and keeps the cache.
- **A refresh puts the right directory at the start of the request, at the cost of one
  full cache write of the history**: everything after the block is written again, once
  (22,000 tokens here; a long real conversation, 100,000 or more). Cache writes cost
  about twice a normal input token, reads a tenth, so that one request costs about as
  much as fifteen ordinary ones. On Will's subscription it's quota, not money.
  Afterwards the cache is warm again (96–98%). It's the same cost a `/model` switch
  already pays.
- **Not tested:** harder work than writing a file (a build, or a long task where the
  model reaches back for paths it used earlier), other models, and conversations days
  old. Twelve trials of one simple task show the stale line isn't routinely harmful;
  they don't show it never is.

### What can be overridden, and what would work

| Option | Where | Effect | Cost | Verdict |
|---|---|---|---|---|
| Restart Claude Code on a change | already done by pi-claude-code | none on what the model sees | — | not a fix on its own |
| Claude Code's flags and variables | `claude` | none (checked) | — | ineffective |
| a. **A note**, in Claude Code's own `# Environment update` words | pier, at `/cd` | right behaviour in 4 of 4; the block still names the old directory | ~100 tokens, cache kept | **now** |
| b. **Refresh the recording** (a `beforeRequest` hook stripping `initialSystemMessages` when the directory differs) | pier, as a workaround | the block names the new directory | one full cache write of the history | works (4 of 4); reaches into pi-claude-code's private replay format, so it breaks silently if that changes |
| c. **The same rule upstream:** drop the recording when the `cwd` differs, as pi-claude-code already does when the model differs | pi-claude-code | as b, without pier knowing the format | as b | **the proper fix** |
| d. **Upstream, cheaper:** pi-claude-code inserts Claude Code's own `# Environment update` (directory and date) where the change happened, keeping the recording | pi-claude-code | right directory and date, in Claude Code's words, cache kept | as a | best of both, more work upstream |
| e. **`/cd` forks** | pier | no contradiction; a new conversation number | one full re-read | heavier than b |

Proposal: a for `/cd` now; c or d added to `todos/upstream.md` with the directory gap
already there (on hold, by Will's choice). b stays here as a tested fallback in case the
stale line ever misleads the model in daily use. And the **date** gets the same
treatment as a: pier adds `# Environment update` / `The date has changed. Today's date
is now …` when a conversation's first request of a day finds the recorded date stale,
about 30 tokens, cache kept. That one fixes every conversation today, not only `/cd`.

Decided (Will, 2026-11-24): *"Let's go with a for now, upstream fixes noted in that todo
spec, and the option of workaround b if in the future we find it necessary to correct
the block."* So `/cd` adds the note, and so does a conversation's first request of a new
day. c and d are in `todos/upstream.md` ("pi-claude-code: a recorded environment block
that goes stale"). b is kept as a tested fallback (`experiments/cwd/act.ts`, `refresh`),
to use only if daily use shows the stale block misleading the model.

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

Decided (Will, 2026-11-24): `/cd` now. A tool, perhaps, but not for every conversation,
since a model that moves itself could step outside its constraints. Ways to bound the
tool, when it's taken up:

- **Granted per conversation,** like a credential (Durable's per-conversation `tools`
  in `pi.agent` already selects which tools a conversation has).
- **Bounded to a root:** only within the directory the conversation started in, or its
  repository and that repository's worktrees.
- **Asking Will:** the tool parks until he approves in the TUI (Durable 1.6.0's tools
  that park).

The bound matters more once project variables and grants are per directory: moving is
then also changing what the conversation may use.

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

Proposal: a, with two changes the checks call for:

- give direnv the whole login environment, and keep only what it changes;
- evaluate in the background when a conversation is created or a watched file changes,
  and tell the model in its prompt while the project's environment isn't ready, or
  wasn't allowed.

**Decided (Will, 2026-11-24): a project's `.env` passes as it is.** *"Perhaps we can
make the simplifying axiom that if a session is pointed at a project, and that project
contains a .env with sensitive values, then that session is allowed to see those
sensitive values. What matters more then is designing a good "Credentials" system such
that a project's sensitive values previously stored in the `.env` file can be later
migrated to the "Credentials" system - allowing stronger access controls. In this
conceiving, one should define the principles behind the Credentials system before then
designing the implementation. Likewise, we should perhaps make a skill or somesuch so
the model isn't suprised that its environment contains sensitive values that could
become accidentally exfiltrated and can mitigate its commands accordingly."*

So project variables are whatever the project's toolchain exports, `.env` included,
with no filtering by pier. Pointing a conversation at a project grants it that project's
secrets. The credentials system (`todos/credentials.md`) is where they move to when a
project wants stronger control. The rest of this section is the analysis that led
there, kept for the record; the filtering it proposed is set aside.

**The problem, in Will's vulcanus-proxmox** (checked 2026-11-24). Its
`devenv.nix` has `dotenv.enable = true`, so entering the project loads its `.env` file
into the shell. direnv's export there has 90 variables. 19 come from `.env`, among them
`PROXMOX_API_PASSWORD`, `GMAIL_PASSWORD`, `PM_PASS`, `TF_VAR_proxmox_api_token_secret`,
`TF_VAR_github_token` and `PUSHOVER_TOKEN`. The other 71 are the toolchain's: `PATH`,
`CC`, `DEVENV_*`, `KUBECONFIG`, `PYTHONPATH`, … A tool that gets the project's variables
gets the passwords too, and so does the model, the moment any command prints its
environment. Those are tier 1 credentials ("Credentials, in tiers"), arriving by the
back door.

**Why not an allowlist of every project variable.** The allowlist (decided) works for
base variables: there are about twenty, the same everywhere, and they can be listed
once. A project's toolchain isn't like that: devenv exported 83 variables for pier,
90 for vulcanus-proxmox, different in each project, and they change when `devenv.nix`
does (a new language adds its own: `GOPATH`, `CARGO_HOME`, `JAVA_HOME`). Listing them
in advance means a tool breaks whenever a project adds one, until Will widens the list.
That's what "an open set" meant.

**What was proposed, and set aside by Will's axiom: tell the two kinds apart by where
they come from.**

- **The toolchain's variables pass:** what devenv's Nix shell sets (`PATH`, `CC`,
  `DEVENV_*`, `PYTHONPATH`, …). They're written in `devenv.nix`, in the repository, and
  aren't secret.
- **The `.env` file's variables are held back:** pier reads the names defined in the
  project's `.env` (the file devenv's `dotenv` loads) and removes those names from what
  direnv exported, unless pier's configuration grants them for that project. Values
  aren't read; only the names, as the check did. A grant names the project and the
  variables:

  ```yaml
  projects:
    ~/repositories/vulcanus-proxmox:
      grant: [KUBECONFIG, TALOSCONFIG, TF_VAR_proxmox_api_url]
  ```

- So the allowlist still holds for secrets, where it matters: nothing from `.env`
  reaches a tool without being named. It's relaxed only for the toolchain, which is
  code Will reviewed in `devenv.nix`.

What "each project's `.env` names allowed per project" meant in tier 1 is that `grant`
list.

**Its limits.** It catches secrets in `.env` only. A secret set directly in
`devenv.nix` (`env.FOO = "secret"`), or by a line in `.envrc`, passes as toolchain.
Will's convention keeps secrets in `.env` (gitignored) and SOPS, so that's the common
case; the others are a project's own mistake, since `devenv.nix` is committed.

**The alternatives:**

- **An allowlist of patterns for all project variables** (`PATH`, `DEVENV_*`, `NIX_*`,
  `PKG_CONFIG*`, `PYTHON*`, `CC`, …), widened by hand. Strictest; breaks a tool whenever
  a project adds a variable outside the patterns.
- **Turning `dotenv` off for agents:** evaluate the project with devenv's `dotenv`
  disabled, so `.env` is never loaded. Exact, but devenv-specific, and needs devenv's own
  evaluation (option b above) rather than direnv's.
- **A denylist by name** (`*PASSWORD*`, `*TOKEN*`, `*SECRET*`, as Codex), already
  rejected: it would miss `PM_PASS` and `PUSHOVER_USER_KEY`.

The interface is "a source of project variables for a directory", so b or f can stand
beside it later. On a machine without Nix, direnv alone still covers projects with an
`.envrc`.

**Telling the model** (Will's "a skill or somesuch"). The model should know its shell may
hold secrets, so it doesn't print them into the transcript (where they're stored, sent
to Anthropic, and kept in the SQLite backups). Options:

- a. **A skill**, `secrets-in-the-environment`, offered with pier's skills: the model
  reads it when its description matches a task. Cheap, and in the format pier already
  uses. But a skill is read on demand, and the moment that matters (about to run `env`
  or `set -x`, or to `cat .env`) doesn't announce itself, so the model may never open it.
- b. **A prompt section, always present when it applies:** pier knows when a
  conversation's project variables include a `.env`'s (it can read the names), so a
  short section says so, names the variables (never values), and gives the rules. A few
  dozen tokens; changes only when the names do, so it keeps the cache.
- c. **Both:** the section states the fact and the variable names, and points to a
  skill with the longer guidance (how to check a variable is set without printing it,
  how to keep secrets out of logs and commits, what to do if one leaks).
- d. **A guard as well as advice:** an `afterTool` hook that replaces any value of a
  named secret in a tool's result with `[redacted: NAME]` before the model or the
  transcript sees it. Durable's `afterTool` can replace a result (README, "Hooks"), and
  pier knows the values (the tool's own variables). It catches the accident advice
  can't: a test that prints its config, a stack trace with a URL. It can't catch a value
  transformed (base64, split across lines).

The guidance itself, whichever carries it:

- check a variable is set with `[ -n "$NAME" ]` or `printenv NAME >/dev/null`, never
  `echo`, `env`, `printenv` or `set` unfiltered;
- no `set -x` or verbose flags (`curl -v`, `ssh -v`) on commands that carry secrets;
- never `cat` a `.env`, secrets file or SOPS-decrypted file; read names with
  `cut -d= -f1`;
- never write a secret into a file that git tracks, a commit message, a PR, or an issue;
- if one is printed, say so, so Will can rotate it.

Proposal: c, and d as well, since advice fails silently and redaction is cheap. The
skill and the section are layer code (`src/layer/`): p3 needs the same.

Decided (Will, 2026-11-24): *"Telling the model: Sure, let's follow your proposal."* So
c and d: a prompt section naming the project's secret variables (names, never values),
a skill with the guidance above, and an `afterTool` hook that replaces their values in
tool results with `[redacted: NAME]`.

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

- **The daemon owns its configuration**, in a file of its own,
  `$XDG_CONFIG_HOME/pier/config.yaml`, read at start. It holds the model, the skills
  directories, agent settings, credential grants, project grants, the base variables'
  list, and the timeout. Environment variables (`PIER_*`) stay as overrides. The daemon
  logs what it read, as it does `PIER_SKILLS` now.

**Is that best practice?** (Will's follow-up, 2026-11-24.) Yes, it's the common pattern
for a daemon run by a service manager:

- **A file in `$XDG_CONFIG_HOME/<app>/`**, per the XDG base directory spec, is how user
  programs on Linux keep configuration, and what home-manager writes for nearly every
  program it configures (Will's `~/.config` has `gh/config.yml`, `starship.toml`,
  `alacritty/alacritty.toml`, `tmux/tmux.conf`, `ketch/`, `todoist-cli/`).
- **The service unit carries only supervision**, and at most a path to the config file
  and a few overrides. Configuration with structure (lists of projects and grants)
  doesn't fit in `Environment=` lines. The docker daemon (`daemon.json`), syncthing
  (`config.xml`) and atuin (`config.toml`) work this way. From general knowledge, not
  re-read for this spec.
- **Environment variables as overrides** follow the twelve-factor convention, and suit
  tests and one-off runs (`PIER_MODEL=… pier daemon`).
- Read at start, as now. Reloading on change (`SIGHUP`, or watching the file) can come
  later, since a restart interrupts runs (`X-SwitchMethod=keep-old`).

**Which format.** All three are common; each has a catch:

| | For | Against |
|---|---|---|
| **JSON** | No dependency; pi's `settings.json` and p2's `settings.json` use it | No comments; strict commas and quotes; tiresome by hand |
| **YAML** | Comments; reads well for nested lists (projects, grants); pier already has the `yaml` package in its tree, through pi-coding-agent's frontmatter parser (2.9.0, checked 2026-11-24); `gh` and Kubernetes use it | Indentation matters; surprising implicit types (`no` as false, `1.10` as a number); several dialects |
| **TOML** | Comments; no indentation rules; explicit types; Rust's and Python's tools, Alacritty and Starship use it | A dependency (`smol-toml`); deeply nested tables are clumsier; less familiar for lists of records |

Decided (Will, 2026-11-24): *"Great, let's go with a daemon-owned YAML config with
schema checking."* The reasons, as proposed: YAML is the most readable for the nested shape here
(projects with grants, credentials in tiers), the parser is already in the tree, and
Nix writes it with `pkgs.formats.yaml`. The implicit-types trap is closed by validating
the parsed file against a schema (pier already uses `pi-schema` for its protocol) and
refusing to start on a mismatch, as the daemon already refuses a model it can't run.
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

### Why some parts aren't covered yet (Will's follow-up)

Each for its own reason; none is an oversight, and each could be taken up on its own.

- **Reach** (files, network, processes, devices): enforcing it means a sandbox, and a
  sandbox is a project of its own, with its own choice (a user namespace with `bwrap`,
  systemd's per-unit sandboxing, Gondolin VMs) and costs (what breaks when `~/.ssh` or
  `/run/user` isn't there, how tools get at the Nix store and the network). It's the
  "more isolated run environments" Will named on 2026-11-17 as a later step. The
  contract names it so that step has a place.
- **Claude Code's own environment:** it's the provider's process, not a tool's. Claude
  Code only talks to the model in pier; Durable runs the tools. Its environment carries
  Claude Code's login, which it needs. It could get its own allowlist later, but that's
  a change to how the provider runs, apart from the tools' contract.
- **Background processes a tool starts:** Durable starts each command in a process
  group of its own and stops tracking it when the call returns. What it left running
  keeps the environment it started with, and only the service's control-group kill ends
  it (a constraint pier already lives with, `AGENTS.md`). Covering them means tracking
  them per conversation, which nothing does yet.
- **Umask, ownership and resource limits beyond a timeout:** they're the daemon's
  process's, inherited by every tool, and they've caused no trouble. A limit per
  conversation would need cgroups per call (`systemd-run --scope`), the same machinery as
  reach.
- **What pier's own extensions read** (AGENTS.md, skills): the daemon reads them from the
  conversation's directory, not through a tool. They follow the place, as the contract
  wants, but they aren't tool calls, so the contract's variables don't apply to them.
- **Time zone and locale beyond the login profile:** nothing has needed them. The login
  shell's `LANG`, `LC_*` and `TZDIR` are passed; `TZ` isn't set on these hosts.

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
login environment, cached per directory. A project's `.env` passes as it is (Will's
axiom, 2026-11-24); the filtering once proposed here was set aside.

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

- **Tier 1, project and tools.** A project's `.env` reaches a conversation in that
  project as it is (Will's axiom, 2026-11-24, above). Credentials not tied to a project
  (a `GH_TOKEN` for a fine-grained token made for agents, decided) are granted by name
  in pier's configuration. The tools' own config files stay readable, since reach isn't
  enforced yet. How a project's secrets move from `.env` into stronger control is
  `todos/credentials.md`.
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
- **Not yet checked:** the steamdeck, as `willy` (offline); how the keyring's agent
  behaves when a tool reaches it by path while the key is locked (it hung once, and
  authenticated once the key was unlocked). A change of `cwd` and Claude Code's warm
  process after it were checked on 2026-11-24 ("What /cd does to the model").

## Open questions for Will

None left from the drafts of 2026-11-24.

## Plan

Written 2026-11-24 for the session that builds this. Claude's ordering, not Will's
decision; each step stands on its own and leaves pier working. Facts below are pier at
0.7.0 (`main` at `7dc5aef`).

1. **The daemon's YAML config** (decided; "d. The service and the daemon").
   - `$XDG_CONFIG_HOME/pier/config.yaml` (or `$PIER_CONFIG`), read once at start,
     parsed with the `yaml` package (in the tree through pi-coding-agent at 2.9.0;
     make it a direct, exact dependency), and checked against a `pi-schema` schema, as
     `src/host/protocol.ts` checks requests. A missing file is an empty config; an
     invalid one stops the daemon with the path and the error, as a bad `PIER_MODEL`
     does now (`src/host/defaults.ts`).
   - It holds what the environment variables hold today (`model`, `thinking`,
     `skills`), with `PIER_*` overriding, plus the new keys the later steps need
     (`tools.variables` for agent settings, `tools.timeout`). Keep the first version
     to what steps 1 to 4 use.
   - The daemon logs what it read, as it logs `skills` now (`src/host/cli.ts`).
   - Dotfiles' `modules/pi/pier.nix` writes it later, with `pkgs.formats.yaml`. That's
     a change in another repository, so Will's to OK.
2. **The contract's variables for every tool call** ("The contract, grouped"; "How
   each part is provided"; "Checked by running").
   - Base: the user's login shell (`getent passwd`, by absolute path) run as
     `<shell> -lc 'env -0'` from `{ HOME, USER }`, filtered to the base list, once at the
     daemon's start.
   - Project: `direnv export json` in the conversation's directory, given the *whole*
     login environment (not the filtered base: it's a diff), cached per directory,
     refreshed when a file in `DIRENV_WATCHES` changes; evaluated in the background so
     a call never waits on a build. A project's `.env` passes as it is (Will's axiom).
   - Agent settings from the config; `PIER=1`, and `PIER_CONVERSATION`.
   - Delivered through bash's `prepare` hook (`createBashTool({ prepare })` replacing
     `CodingTools`' bash), with `inheritEnv: false` and the variables in the call's
     `env`, **not** `NodeExecutionEnv`'s `shellEnv`, which `inheritEnv: false` drops
     (checked).
   - Remove `pier.client-env` (`ClientEnvDoc` in `src/host/daemon.ts`) and `attach`'s
     `env` (`src/host/protocol.ts`, and the client's `environment()` in
     `src/host/cli.ts`). That's a protocol change: bump `PROTOCOL_VERSION`. Old stored
     `pier.client-env` documents are simply no longer read.
   - Test, over a real socket with the faux model: a variable set only in the daemon's
     process, and one sent by a pane, don't reach a tool; a project's direnv variable
     does. Then disable the change and watch the test fail (`docs/principles.md`, 5).
   - Shape it for the layer (`src/layer/`): the contract, the probe and the direnv
     source are what p3 would need; the daemon only wires them.
   - Then run `experiments/environment/contract-check.mjs` again, and a day of daily use,
     before the next step. Record anything a command lacked.
3. **Telling the model about secrets** (decided; "Telling the model").
   - A prompt section, present when the project's variables include a `.env`'s, naming
     those variables (never values), and pointing to the skill.
   - A skill, offered with pier's own (a directory of pier's added to the skills
     extension), with the guidance listed there.
   - An `afterTool` hook replacing any of those values in a tool's result with
     `[redacted: NAME]`. Test it with a faux tool that prints a secret.
   - Layer code.
4. **`/cd`, and the date** (decided: option a; "What can be overridden").
   - `/cd <dir>` in the TUI: a protocol request that checks the directory exists on the
     daemon's machine, `configure({ cwd })`, and adds Claude Code's own wording to the
     conversation: `# Environment update` / `Primary working directory: <new> (was
     <old>)`. Where the note goes (a `SystemEntry` with content, or an `instructions`
     change) is the builder's to measure: `experiments/cwd/act.ts`'s `note` variant used
     `instructions`.
   - The date: on a conversation's first request of a day, when pi-claude-code's
     recorded block names an earlier date, add `# Environment update` / `The date has
     changed. Today's date is now <date>.` Fixes every conversation, not only `/cd`.
   - Check with `experiments/cwd/act.ts` (a few Opus turns, so ask Will first), and
     with offline tests for the protocol and the note.
   - A model-facing `cd` tool is not in this plan (Will: not for every conversation).
5. **Credentials** wait for their own spec (`todos/credentials.md`): the principles are
   settled; its design questions come next, then the agents' GitHub token as the first
   credential (decided). Until then tools have no credentials but what their reach
   gives them (`SSH_AUTH_SOCK` is no longer passed; a key unlocked in the keyring is
   still usable by path, as checked).

What changes for Will on step 2's day, worth telling him before it lands:

- **`git push` from a conversation stops working** unless a credential reaches it. pier
  pushes to `git@github.com:DArtagan/pier.git` over SSH, and today that works only
  because the pane's `SSH_AUTH_SOCK` is passed through. Either keep passing
  `SSH_AUTH_SOCK` as an agent setting until the GitHub token exists (one config line;
  his call), or switch the remote to HTTPS with the token (`gh`'s `git_protocol` is
  already `https`).
- **A `nix shell` or `export` in a pane** no longer reaches the tools; put it in the
  project's `.envrc` or the config.

When the plan is done: the contract goes in `README.md`, `docs/history.md` records the
reversal of 2026-10-29, `todos/remote.md` is refreshed from what was built (its
component 4 is this spec), and this file is deleted.

Deferred to implementation (Will, 2026-11-24): which machines and users an agent's SSH
key reaches.

## Done when

Steps 1 to 4 of the plan are built: every conversation's tools run with exactly the
contract's variables, a test shows a variable set only in a pane doesn't reach a tool
(and fails without the change), the model is told of a project's secrets and they're
redacted from tool results, and `/cd` and a new day each add their note. Then the
contract goes in `README.md`, `docs/history.md` records the reversal of 2026-10-29,
`todos/remote.md` is refreshed from it, and this file is deleted. Credentials (step 5)
carry on in `todos/credentials.md`.
