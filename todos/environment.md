# The environment contract: what a conversation's tools run with

## Opening prompt

> Read `AGENTS.md` and `docs/principles.md`, then this spec. Build the plan's steps in
> order, on a branch in a worktree, each step its own commit or pull request, with
> tests that fail without it. Everything the plan needs was decided by Will on
> 2026-11-24 (below). Where a step needs a choice this doesn't settle, ask him rather
> than guess, and record his answer here, verbatim and dated. Open
> `environment.evidence.md` only to re-examine a conclusion; re-run its checks before
> relying on a number (`experiments/environment/`, `experiments/cwd/`). When steps 1 to
> 4 are built, refresh `todos/remote.md` from them, then delete this spec and its
> evidence.

Written 2026-11-24. Will asked for it that day: *"Passing through the pane's whole
environment might not be the best plan after all. … A good place to start might be by
explicitly defining what the parts of an "environment" are (e.g. working directory,
environment variables, etc.). That will form a formal interface contract, and anything
not in that contract should be isolated away/disallowed. After doing that, we can
determine how each component in the interface contract is provided."*

It's its own spec, not part of `todos/remote.md`, because it changes local panes as much
as remote ones. Remote pier waits on it: a remote pane's environment is meaningless on
the far host. Will: *"I'm going to start by first implementing the environment work,
and then using that to refresh the remote.md spec - before beginning work on it."*

## Where things stand

Nothing is built. pier 0.7.0 (`main` at `7dc5aef`): `attach` sends the pane's whole
environment, stored as `pier.client-env` (`ClientEnvDoc`, `src/host/daemon.ts`) and laid
over the daemon's own for every tool call. That was Will's decision of 2026-10-29
(*"keep it simple by passing through the whole environment. We can refine it later."*),
which this reverses.

The contract was checked by running on thenixbeast on 2026-11-24, outside any terminal,
through Durable's own `NodeExecutionEnv`: git, nix, locale and UTF-8 work; a pane's
variables, the SSH agent and the display stay out; and the keep-out checks fail when run
as pier is today. The steamdeck (as `willy`) wasn't checked; it was offline.

## Decided

Will, 2026-11-24, verbatim:

- **Panes stop passing their environment:** *"Yes, panes should stop passing their
  whole environment."* For local panes too.
- **An allowlist:** *"Allowlist is a good principle."*
- **The contract and its groups:** *"This seems like a fairly cogent definition. I think
  these parts may be able to group themselves together some"*, and on the four groups
  below, *"Yes."*
- **Base variables:** *"Login shell sounds good as a base."*
- **A project's `.env`:** *"if a session is pointed at a project, and that project
  contains a .env with sensitive values, then that session is allowed to see those
  sensitive values. What matters more then is designing a good "Credentials" system such
  that a project's sensitive values previously stored in the `.env` file can be later
  migrated"* (`todos/credentials.md`).
- **Telling the model:** *"we should perhaps make a skill or somesuch so the model isn't
  suprised that its environment contains sensitive values"*, and on the proposal (a
  prompt section, a skill, and redaction), *"Sure, let's follow your proposal."*
- **The configuration:** *"let's go with a daemon-owned YAML config with schema
  checking."* And on the line between the service and the daemon: *"Ideally we build
  something that is portable to non-Nix systems."*
- **Changing directory:** *"we need a `/cd` command. A tool to do the same could be very
  useful, but we may not want to grant it to every conversation - as it could let a
  model/conversation change its own directory and effectively work-around the
  environment constraints we've set up."*
- **`/cd`'s note:** *"Let's go with a for now, upstream fixes noted in that todo spec,
  and the option of workaround b if in the future we find it necessary to correct the
  block."*
- **Credentials:** *"I like your tiers. We can defer which specific machines & users
  when it comes to implementatiton."* *"Yes to a `GitHub` token made for agents."* The
  rest is `todos/credentials.md`.

Will, 2026-11-25, verbatim, on step 2's open questions:

- **Dotfiles writes the config:** asked whether Claude may change `modules/pi/pier.nix`
  to write `config.yaml`, *"Please do."*
- **A tool call before the project's environment is ready:** on waiting for direnv up
  to a limit, then running without the project's variables, *"Yes, go with your
  proposal - make the limit configurable."*
- **`PIER_CONVERSATION`:** *"host#number is a good convention, go with that."* So
  `thenixbeast#3`.

## The contract

An environment is where and how a conversation's tools run. Every part has one source,
decided by the conversation and pier's configuration, never by the pane that attached
last. Four groups, each a question:

| Group | Part | What the contract says |
|---|---|---|
| **Place**: where do tools run? | machine and user | the pier that owns the conversation |
| | working directory | the conversation's `cwd` (`pi.agent`), an absolute path that must exist; changed only through pier (`/cd`) |
| | reach (files, network, processes) | everything the user can reach, until isolation is built. Named so it has a place to go |
| **Variables**: what's in the process's environment? | base | the user's login shell, read once, filtered to a fixed list |
| | project | direnv's export in the working directory, `.env` included |
| | agent settings | pier's config: `GIT_CONFIG_GLOBAL`, `PAGER=cat`, `GIT_PAGER=cat`, … |
| | the call's identity | `PIER=1`, `PIER_CONVERSATION` |
| **Credentials**: as whom can a tool act elsewhere? | tokens, SSH, root | none by default; each granted by name, in tiers (`todos/credentials.md`) |
| **Execution**: how does a call run? | shell | bash, non-login, non-interactive |
| | limits | a call's timeout (none by default today) |
| | stdin, terminal | none: stdin closed, no TTY |

The base list: `HOME USER LOGNAME SHELL PATH LANG LC_* TZ TZDIR TMPDIR LOCALE_ARCHIVE
NIX_PATH NIX_PROFILES NIX_USER_PROFILE_DIR TERMINFO_DIRS XDG_DATA_DIRS XDG_CONFIG_DIRS
XDG_RUNTIME_DIR`, and `TERM=dumb`; a name the login shell doesn't set is left out.

Everything else is kept from tools: the pane's terminal (`TMUX`, `ALACRITTY_*`), the
desktop (`DISPLAY`, `WAYLAND_DISPLAY`, `SWAYSOCK`, D-Bus), the shell's state, anything
exported by hand, the client's machine, and any credential not granted. Kept from means
the command starts with only the contract's variables: an allowlist, never a denylist.

**Variables aren't a boundary.** A tool runs as Will. It can read `~/.ssh`, reach the
keyring's agent (`/run/user/1001/gcr/ssh`) and the tmux server by their paths, and read
a pane's environment from `/proc`. Checked: with the key unlocked, a tool authenticated
to GitHub as Will through the agent's path, with no variable set. Leaving variables out
stops accidental use; only isolation stops a deliberate one.

## How each part is provided

- **Base:** the login shell from `getent passwd`, by absolute path (an empty environment
  has no `PATH` to find it with), run as `<shell> -lc 'env -0'` from `{ HOME, USER }`,
  once at the daemon's start, then filtered. Works without Nix.
- **Project:** `direnv export json` in the working directory, given the *whole* login
  environment, not the filtered base: direnv reports a difference against what it's
  given, and given the filtered base it re-adds the desktop's variables. Cached per
  directory, refreshed when a file in `DIRENV_WATCHES` changes, evaluated in the
  background: a first evaluation took 3.5 s for pier and 25.7 s for vulcanus-proxmox,
  then 0.13 s. Only an allowed `.envrc` runs. A project whose environment isn't ready,
  or isn't allowed, is said so in the prompt.
- **Agent settings and identity:** the config's `tools.variables`, plus `PIER=1` and
  `PIER_CONVERSATION`.
- **Delivery:** bash's `prepare` hook (`createBashTool({ prepare })`, in place of
  `CodingTools`' bash) sets each call's `env` to the contract's variables, with
  `inheritEnv: false`. **Not** `NodeExecutionEnv`'s `shellEnv`: `inheritEnv: false`
  drops it too, leaving a command with no `PATH` (checked; Durable 1.6.0, `env/node.ts`,
  `getShellEnv`). `read`, `write` and `edit` take no environment.
- **The configuration:** `$XDG_CONFIG_HOME/pier/config.yaml` (or `$PIER_CONFIG`), owned
  by the daemon, read at start, checked against a `pi-schema` schema; `PIER_*` variables
  override it. The service manager only supervises (start, restart, control-group kill).
  Nix writes the file on Will's hosts (`pkgs.formats.yaml`); elsewhere it's written by
  hand.

## Plan

Claude's ordering. Each step leaves pier working.

1. **The YAML config.** Parse with `yaml` (in the tree at 2.9.0 through pi-coding-agent;
   make it a direct, exact dependency), check with `pi-schema` as `src/host/protocol.ts`
   checks requests. A missing file is an empty config; an invalid one stops the daemon
   with its path and the error, as a bad `PIER_MODEL` does (`src/host/defaults.ts`). It
   holds what the variables hold now (`model`, `thinking`, `skills`) plus
   `tools.variables` and `tools.timeout`; nothing more yet. The daemon logs what it
   read, as it logs `skills` (`src/host/cli.ts`). Dotfiles' `modules/pi/pier.nix` writes
   it later: another repository, so Will's to OK.
2. **The contract's variables for every tool call**, as above. Remove `pier.client-env`
   and `attach`'s `env` (`src/host/protocol.ts`, the client's `environment()` in
   `src/host/cli.ts`), and bump `PROTOCOL_VERSION`; stored `pier.client-env` documents
   are no longer read. Shape the contract, the probe and the direnv source for
   `src/layer/` (p3 needs the same); the daemon only wires them. Test over a real
   socket with the faux model: a variable set only in the daemon's process, and one a
   pane sends, don't reach a tool; a project's direnv variable does. Then disable the
   change and watch the test fail. Re-run `experiments/environment/contract-check.mjs`
   and use it for a day before step 3.
3. **Telling the model about secrets.** A prompt section, present when a project's
   variables include its `.env`'s, naming them (never values) and pointing to a skill;
   the skill, offered with pier's own, with the guidance: check a variable is set with
   `[ -n "$NAME" ]`, never print it; no `set -x` or verbose flags on commands that carry
   secrets; never `cat` a `.env` or a decrypted file; never write a secret into a
   tracked file, commit, pull request or issue; say so if one is printed. And an
   `afterTool` hook replacing their values in tool results with `[redacted: NAME]`,
   tested with a faux tool that prints one. Layer code.
4. **`/cd`, and a new day.** `/cd <dir>` is a protocol request: check the directory
   exists on the daemon's machine, `configure({ cwd })`, and add Claude Code's own
   wording to the conversation: `# Environment update` / `Primary working directory:
   <new> (was <old>)`. On a conversation's first request of a day, when the date
   pi-claude-code recorded is earlier, add `# Environment update` / `The date has
   changed. Today's date is now <date>.` Offline tests for both; a check with
   `experiments/cwd/act.ts` costs Opus turns, so ask Will first. No `cd` tool for the
   model (Will: not for every conversation).
5. **Credentials** carry on in `todos/credentials.md`, starting with the agents' GitHub
   token. Until then tools get no credential but what their reach gives them.

**Tell Will before step 2 lands:** `git push` from a conversation stops working. pier's
remote is `git@github.com:DArtagan/pier.git`, which works today only because the pane's
`SSH_AUTH_SOCK` is passed through. Either keep passing `SSH_AUTH_SOCK` as an agent
setting until the GitHub token exists, or switch the remote to HTTPS with the token
(`gh` already uses `https`). His call. And a `nix shell` or `export` in a pane no longer
reaches tools; it belongs in `.envrc` or the config.

## Why `/cd` needs a note

Claude Code tells the model its working directory and today's date in an environment
block near the start of each request. pi-claude-code records that block on a
conversation's first request and replays it for the life of the conversation, which
keeps the prompt cache warm; it records afresh only when the model changes. So after a
change of directory, and on every day after the first, the block is stale. In Will's
store on 2026-11-24, 498 of 1,746 answers were given under a recorded date that wasn't
that day's.

Tested with real Claude (12 trials): after `configure({ cwd })` the model worked in the
new directory every time, with or without a note, because pier's `<cwd>` section comes
after the history. A note costs about 100 tokens and keeps the cache. Workaround b
(strip the recording when the directory differs, so a fresh block is recorded) gives a
correct block for one full cache write of the history; it's kept in reserve
(`experiments/cwd/act.ts`, `refresh`), for if daily use shows the stale block misleading
the model. The proper fix is pi-claude-code's (`todos/upstream.md`, "a recorded
environment block that goes stale").

## Rejected, and why

- **Filtering a project's `.env` out unless granted:** set aside by Will's axiom. The
  credentials system is where those secrets go for stronger control.
- **An allowlist for project variables:** a toolchain's variables differ per project and
  change with `devenv.nix` (83 for pier, 90 for vulcanus-proxmox), so a fixed list
  breaks tools whenever a project adds one.
- **A denylist by name** (`*TOKEN*`, `*SECRET*`, as Codex's and Claude Code's scrubs):
  misses `PM_PASS` and `PUSHOVER_USER_KEY`, and anything new.
- **The daemon's own environment as the base:** it's whatever systemd's user manager
  had when it started, which differs between a desktop login and a lingering manager.
- **Claude Code's switches** (`--exclude-dynamic-system-prompt-sections`,
  `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT`, `CLAUDE_CODE_HIDE_CWD`): none changes the block
  pi-claude-code replays.
- **Restarting Claude Code on a directory change** isn't a fix: pi-claude-code already
  does, and replaces the fresh block with the recorded one.
- **A passwordless sudo rule for `nh os switch`:** an agent that can edit the flake it
  switches to has root (`todos/credentials.md`, tier 3).

## Wrong turns

- The first guess was that a change of directory would cost a full re-read of the prompt
  cache. Measured, it cost about 1,500 tokens of cache writes, as a cold turn does.
- The first negative control for the contract check passed everything: a flipped
  boolean ran the contract twice. Caught because it passed.
- The first probe failed to find `bash`: an empty environment has no `PATH`. The login
  shell is named by its absolute path.

## Not covered, on purpose

Reach (until isolation is built); Claude Code's own environment (the provider's, which
pi-claude-code passes on without `ANTHROPIC_API_KEY`); background processes a tool
leaves running (they keep their variables, and die only with the service's control
group); umask and resource limits beyond a timeout (the daemon's); time zone and locale
beyond the login profile. Each is a step of its own when it's wanted.

## Done when

Steps 1 to 4 are built: every tool call runs with exactly the contract's variables; a
test shows a variable set only in a pane doesn't reach a tool, and fails without the
change; the model is told of a project's secrets, and their values are redacted from
tool results; `/cd` and a new day each add their note. Then the contract goes in
`README.md`, `docs/history.md` records the reversal of 2026-10-29, `todos/remote.md` is
refreshed from what was built, and this spec and its evidence are deleted.
