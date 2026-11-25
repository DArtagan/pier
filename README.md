# pier

pi on [Pi Durable](https://earendil.com/posts/pi-durable): one daemon per host owns
every pi session, and terminals (later web and phone) attach to it as thin clients.
Like a pier: it stays put, and boats tie up and cast off.

**Status:** a deliberately thin slice, in daily use: a daemon, a Unix socket, and a
terminal client drawn with pi's own components. Claude runs on a Durable Harness
through Claude Code, with your Claude subscription, and survives a crash mid-tool, Esc,
compaction and forks (pi 1.6.0). See [`todos/`](todos/) for what's next.

## Use

```bash
pier daemon           # the daemon, in the foreground (dotfiles runs it as a user service)
pier                  # in a project: continue its newest conversation, or start one
pier new              # start a new one
pier resume <n>       # attach to conversation #<n>
pier list [--all]     # conversations here (or everywhere)
pier --tui-mode regular …  # the client in the terminal's own scrollback, not fullscreen
```

In this repo, `npm run pier -- <args>`, or `node src/host/cli.ts`; the package (dotfiles
builds it with Nix) runs `dist/`, from `npm run build`. In the client,
`/help` lists the keys and commands. Enter sends, and steers while Claude works;
Alt+Enter queues a follow-up, and Alt+Up takes what's queued back into the editor; Esc
stops the run; Ctrl+C on an empty editor leaves, and the run carries on. Up in an empty
editor recalls the conversation's earlier messages, from every session, as in pi. When
the daemon restarts, the client reconnects and carries on where it left off. Queued
messages stay above the editor until the run takes them in; the client's own lines
("new conversation #3", "compacting in the background", errors) go into
the transcript, and scroll away with it.

**Blocked.** When Durable has no code that fits one of a conversation's tasks, it
blocks the task rather than ending it: no installed code takes it (`missing_task`), a
newer pier started it (`task_too_old`, after going back to an older pier), or its saved
state couldn't be brought up to date (`migration_failed`). The task waits, unchanged,
and an ordinary one holds its conversation busy. Durable's remedy is the code that fits:
run the pier (or install the extension) the task needs, and it carries on where it
stopped. Esc gives it up instead, as Durable's "orphaned": none of the task's own code
runs, so whatever cleanup it would have done is skipped.

The client says so in the transcript, once: which task, why, what would run it, and
what Esc costs. The editor's border reads `⚠ Blocked: … · Esc gives it up` in place of
the working line while it lasts; `/resume`, `/tree` and `pier list` show the
conversation as `blocked`; and the daemon logs it. A blocked background task holds
nothing up and Esc doesn't reach it, so only the transcript and the log tell of it.

Typing `/` opens pi's menu of commands, which more letters filter; a command's
argument is picked from a menu of its own, with the arrows and Enter:

- `/model` and `/thinking`: the models the daemon has credentials for, and the levels
  the conversation's model supports (one it doesn't is clamped, as pi clamps it).
- `/resume`: every conversation, those in this directory first.
- `/fork`: one of your messages. A new conversation starts with the history before it,
  and the message goes back into the editor, as pi's `/fork` does.
- `/tree`: the conversation's family of forks, from the root down, to switch between.
  A fork is shown by its first message of its own, with how many it has, its newest,
  and when it was last used. A fork from before the first message belongs to the family
  too. Each branch is a conversation of its own, with its own Claude Code prompt cache: going
  back to one reads its context from the cache (99.8%, by hand on 2026-11-16), as long
  as it's been idle under the hour pi-claude-code's cache entries last.

The client runs fullscreen, on the alternate screen, as pi does by default: it scrolls
(PageUp, Ctrl+Home, Ctrl+End), jumps between your messages (Ctrl+Up, Ctrl+Down),
searches (Ctrl+Shift+F), copies a mouse selection, and leaves the transcript in the
terminal's scrollback when you leave. `--tui-mode regular`, pi's flag, draws it in the
terminal's own scrollback instead.

It looks like pi, as it's drawn by pi's components, in pi's theme, with your `theme`,
`hideThinkingBlock` and `showHardwareCursor` from pi's `settings.json` (the last puts
the terminal's own cursor in the editor, so a pane that loses focus shows none, or a
hollow one when the terminal's window does):

- **Model responses** with their thinking (Ctrl+T hides it), **tool calls** in pi's
  coloured blocks (grey while running, green done, red failed), with edits as diffs and
  long output collapsed (Ctrl+O expands it), and **compaction summaries** (Ctrl+O too).
- **pi's working line** in the editor's border while a run goes, and after each run a
  **run line**, with the facts pine-of-glass's cachemire prints: `◍ run: 3 turns · 9s ·
  read 5.8k (99.9% cached) · wrote 1.2k · out 0.1k`.
- **A footer** as pi's: the conversation and directory; tokens, what its model
  responses would have cost at API prices ("(sub)": you're on the plan), the context
  used, the model and thinking level; and the Claude plan's 5-hour and 7-day windows,
  as pi-quotas shows them.
- A long outage leaves no hole: the client loads what it missed. `/earlier` loads older
  messages.

The terminal must answer pi's color query for tool blocks' backgrounds; a tmux pane no
client is showing may not, and then they're blank.

pier says what Durable says (its README, "Concepts"): a **turn** is one model response
and its tool calls; a **run** is the turns from an input to its **final answer**, the
response with no tool calls that ends it. A conversation is busy while a run is going.

Conversations are numbered #1, #2, … on each host. Any number of panes can attach to
one conversation. Each conversation's tools run in its directory, with the variables
the environment contract gives them, and nothing of the pane's (below).

The socket is `$XDG_RUNTIME_DIR/pier/pier.sock` and the storage
`$XDG_STATE_HOME/pier/pier.sqlite`; `PIER_SOCKET` and `PIER_STATE_DIR` override them.

## Configuration

The daemon owns its configuration: `$XDG_CONFIG_HOME/pier/config.yaml`, or the file
`PIER_CONFIG` names. It's read once, when the daemon starts, which logs what it read.
No file means the defaults. A file that isn't YAML, or holds a key or value pier doesn't
know, stops the daemon with the file's path and what's wrong: quote a value that YAML
would read as a number or a boolean (`"1.10"`, `"yes"`).

```yaml
model: claude-code/claude-opus-5-5   # provider/model, for new conversations
thinking: high                       # one of pi's thinking levels
skills:                              # skill directories, absolute (below, "Skills")
  - /nix/store/…-ketch/share/skills/ketch
tools:
  variables:                         # set for every tool call
    GIT_CONFIG_GLOBAL: /home/will/.config/git/config-agent
  timeout: 600                       # seconds, for a bash call that sets none
```

`PIER_MODEL`, `PIER_THINKING` and `PIER_SKILLS` override `model`, `thinking` and
`skills`. The daemon refuses to start with a model it can't run, or a thinking level
that isn't pi's. `tools` is what tool calls run with (below), and `tools.projectWait`
(seconds, default 60) how long a call waits for its project's environment. On Will's
hosts Nix writes the file; elsewhere it's written by hand. The service manager
(systemd, or a foreground `pier daemon`) only supervises.

## The environment tools run with

A tool call gets exactly these variables, later ones winning, and nothing else: not the
daemon's own, not the pane's. An allowlist, never a denylist (`src/layer/environment.ts`).

- **Base:** the user's login shell (`getent passwd`), run once at the daemon's start as
  `<shell> -lc 'env -0'` from only `HOME` and `USER`, as a new terminal gets it, then
  kept to `HOME USER LOGNAME SHELL PATH LANG LC_* TZ TZDIR TMPDIR LOCALE_ARCHIVE NIX_PATH
  NIX_PROFILES NIX_USER_PROFILE_DIR TERMINFO_DIRS XDG_DATA_DIRS XDG_CONFIG_DIRS
  XDG_RUNTIME_DIR`, and `TERM=dumb`. A change to the profile reaches tools at the
  daemon's next start.
- **Project:** `direnv export json` in the conversation's directory, given the whole
  login environment (direnv reports a difference against what it's given). Only an
  allowed `.envrc` runs. A project's `.env`, if its `.envrc` loads it, passes as it is:
  pointing a conversation at a project grants it the project's secrets. Evaluated in the
  background and cached per directory, again when a file direnv watches changes (the
  `.envrc`, devenv's files, `direnv allow`). A call waits for an evaluation up to
  `tools.projectWait`, then runs without it; the prompt says when the project's
  environment is still being prepared, isn't allowed, or failed.
- **Agent settings:** the configuration's `tools.variables`, such as `GIT_CONFIG_GLOBAL`
  or `PAGER=cat`.
- **Identity:** `PIER=1` and `PIER_CONVERSATION=<host>#<number>`, as `thenixbeast#3`.

A call runs in bash, non-login and non-interactive, with stdin closed and no terminal,
in the conversation's directory, under `tools.timeout` when the model sets none. `read`,
`write` and `edit` take no environment.

So a `nix shell`, an `export` or an `ssh-agent` in a pane doesn't reach tools: put it in
the project's `.envrc`, or in `tools.variables`. **Variables aren't a boundary.** A tool
runs as you: it can still read `~/.ssh`, reach an SSH agent or the tmux server by its
socket's path, and read other processes' environments in `/proc`. Leaving variables out
stops accidental use, not a deliberate one; only isolation would. Claude Code's own
environment is the daemon's, which pi-claude-code passes on: it's the provider's, not a
tool's.

## Layout

- `src/layer/` is what carries over to p3 (`docs/vision.md`), and never imports the
  host:
  - `claude-code.ts` loads Earendil's
    [pi-claude-code](https://github.com/earendil-works/pi-claude-code), the provider that
    sends requests through Claude Code (below);
  - `prompt.ts` builds the system prompt from AGENTS.md files, found the way pi finds
    them;
  - `skills.ts` lists the skills the model is offered (below);
  - `environment.ts` is the environment contract: the variables tool calls run with
    (above).
- `src/host/` is what's thrown away when p3 takes over: `daemon.ts` runs the Harness and
  serves it on the socket, `protocol.ts` is what goes over it (the daemon checks each
  request against its schemas), `client.ts` and `tui.ts` are the client (`commands.ts`
  its slash commands and their menus), and `cli.ts` is `pier` (`config.ts` the daemon's
  configuration, `defaults.ts` the model it runs).
- `experiments/gate/` holds the gate: real Claude Code turns against a Durable Harness,
  each step in its own process so it can be killed.
- `experiments/wire/` measures what a conversation watch sends.
- `experiments/transcript/` measures the terminal client with a long transcript.
- `experiments/environment/` runs tool commands as the environment contract does
  (above), outside any terminal: what works, what's kept out
  (`contract-check.mjs`), and what a tool can still reach as you (`authority-check.mjs`).
- `experiments/cwd/` studies Claude Code's environment block: what it says under
  different directories and flags, against a stub API (`env-block.ts`); and, with real
  Claude, what a change of directory or model does to it, to the prompt cache, and to
  where the model works (`run.ts`, `act.ts`, `model.ts`).
- `test/` holds offline tests, with a faux model in place of Claude: the daemon and its
  clients over a real socket, the prompt, and the provider's loading.
- `todos/` holds specs for work not yet done, each with the evidence it rests on beside
  it (`<name>.evidence.md`); `todos/README.md` says how they're written.
- `docs/` describes pier as it is now; `docs/README.md` lists what's there:
  - `docs/vision.md` says what pier is for, and how it changes as p3 does.
  - `docs/principles.md` holds the principles all work on pier keeps to.
  - `docs/releasing.md` says how release-please makes versions.
  - `docs/updating.md` says how to move pier to a new pi release, and its dependencies
    with it.
  - `docs/history.md` records Will's decisions, the gate's findings and the wrong
    turns.
  - `docs/upstream.md` holds what pier relies on from Earendil, and where Earendil is
    going, as last read.

## Commands

```bash
direnv allow          # once; or `devenv shell`. Installs node_modules and the git hooks.
npm test              # offline unit tests (also a pre-commit hook)
npm run check         # typecheck (also a pre-commit hook)
npm run build         # compile src/ to dist/, which the package's `pier` runs
devenv test           # both
npm run gate          # the gate: about twenty Opus turns on your Claude Code login
```

The gate prints a PASS/FAIL line per check and leaves its state directory in `/tmp`: the
SQLite storage, and every event (`transcript.jsonl`).

## Claude, through Claude Code

pier talks to Claude with Earendil's pi-claude-code. It sends each request through
`claude -p`, on Claude Code's own login, so it uses your Claude subscription. Claude
Code only talks to the model; Durable runs the tools. It's a plain pi-ai provider,
registered with `ModelRuntime.registerNativeProvider()`, so it needs nothing from pi's
extension API. Its models are `claude-code/<model>`.

Things a host must know, all found by the gate:

- **Release each conversation's warm Claude Code process.** pi-claude-code keeps one
  per conversation for straight continuations, and frees it when pi-ai's
  `cleanupSessionResources(sessionId)` is called with the conversation's provider
  session id. pi does that when a session ends. Durable does it only when the Harness
  closes, so pier's daemon also does it once a conversation has idled for five
  minutes.
- **Claude Code would run in the host's directory**, which it reports to the model as
  its working directory: pi-claude-code starts it in `process.cwd()`, and nothing in a
  request names a directory. pier's `ConversationDirectories` extension records each
  conversation's directory before its requests, and the provider pier loads runs each
  request in a scope where `process.cwd()` answers it (`src/layer/claude-code.ts`).
  A provider option upstream would replace that.
- **It spawns Claude Code detached**, as Durable spawns tools, so only a control-group
  kill reaps them if the host dies.
- **The prompt cache** survives an idle conversation for up to an hour: every entry is
  written with a 1-hour lifetime.

Until 2026-11-13 pier used pi-claude-bridge instead, through a shim standing in for
pi's extension API. It's in git history, and `docs/history.md` records what it took.

## Skills

The prompt lists the skills the model may use, in the
[agentskills.io](https://agentskills.io) format: each skill's name, description and
`SKILL.md`. When a task matches one, the model reads its `SKILL.md` with the `read` tool,
then runs the command it describes with `bash`, under the environment contract (above).
So the command must be on the login shell's PATH, or the project's. They come from two places, read before each
request, so a change shows on the next one:

- **`skills`** in the configuration, or **`PIER_SKILLS`**: the daemon's skill
  directories, absolute paths (in `PIER_SKILLS`, separated by `:` as in `PATH`). Each is one skill (holding `SKILL.md`) or a directory of them. Point it
  at a package's `share/skills/<pname>`, where nixpkgs' `installAgentSkills` hook puts
  a package's skills (`share/skills/<pname>/<skill>/SKILL.md`). The daemon reads it
  when it starts, and logs the list.
- **The project's own**: `.agents/skills` and `.pi/skills` in the conversation's
  directory and each one above it, up to the repository's root (`.git`); outside a
  repository, only its own directory.

When two skills share a name, the project's wins, then the nearer directory, then the
earlier one in the list. pier reads nothing of classic pi's for skills: not
`~/.pi/agent/skills`, not `settings.json`, not pi packages. Without either, only
projects' skills are offered.

**No trust check.** A project's skills load without asking, as its AGENTS.md does
(Will, 2026-11-17: "No, let's not ask"). A repository you open can put instructions in
the prompt either way, and a prompt on skills alone would protect little.
agentskills.io suggests gating them on trust, as classic pi does. Isolating what a
conversation can reach is the place to revisit this.

## Known gaps

- A tool call has no timeout unless the model sets one: Durable's bash has no default.
- One environment per conversation: two panes in different shells on one conversation
  take turns deciding it.
- `pier` (continue) scans up to 500 conversations each time.
- The protocol has no backpressure: a slow client's socket buffers.
- The socket is chmodded to 0600 just after it starts listening; in its 0700 directory
  that gap doesn't matter.
- A project's skills load without asking, as its AGENTS.md does (below, "Skills").
- Images show only as pi's placeholders (`[Image: [image/png] 64x64]`): Alacritty has
  no image protocol, and pi-tui shows none under tmux. Claude sees them: it read a PNG
  and named its colour, by hand on 2026-11-16.

## Versions

pi's packages are pinned exactly in `package.json`, all to one release (1.6.0). Pi
Durable is experimental, and breaking changes land in minor releases, so bump them
together and deliberately, as `docs/updating.md` says.

pier doesn't follow the pi that nixpkgs ships (1.5.0 on 2026-11-12). Its packages come
from its own lockfile, so nothing ties the two together. What pier shares with classic
pi is `~/.pi/agent`: settings and credentials.

pi-claude-code isn't on npm. It's pinned to a commit, as a GitHub tarball
(`codeload.github.com`), so installs need no git and no SSH key.

## License

MIT
