# pier

pi on [Pi Durable](https://earendil.com/posts/pi-durable): one daemon per host owns
every pi session, and terminals (later web and phone) attach to it as thin clients.
Like a pier: it stays put, and boats tie up and cast off.

**Status:** a deliberately thin slice, in daily use: a daemon, a Unix socket, and a
terminal client drawn with pi's own components. Claude runs on a Durable Harness
through Claude Code, with your Claude subscription, and survives a crash mid-tool, Esc,
compaction and forks (pi 1.5.2). See [`todos/`](todos/) for what's next.

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
Alt+Enter queues a follow-up; Esc stops the run; Ctrl+C on an empty editor leaves, and
the run carries on. When the daemon restarts, the client reconnects and carries on
where it left off.

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
one conversation. Each conversation's tools run in its directory, with the environment
of the last pane that attached to it.

The socket is `$XDG_RUNTIME_DIR/pier/pier.sock` and the storage
`$XDG_STATE_HOME/pier/pier.sqlite`; `PIER_SOCKET`, `PIER_STATE_DIR`, `PIER_MODEL`
(`claude-code/claude-opus-5-5`) and `PIER_THINKING` (`high`) override them.

## Layout

- `src/layer/` is what carries over to p3 (`docs/vision.md`), and never imports the
  host:
  - `claude-code.ts` loads Earendil's
    [pi-claude-code](https://github.com/earendil-works/pi-claude-code), the provider that
    sends requests through Claude Code (below);
  - `prompt.ts` builds the system prompt from AGENTS.md files and skills, found the way
    pi finds them.
- `src/host/` is what's thrown away when p3 takes over: `daemon.ts` runs the Harness and
  serves it on the socket, `protocol.ts` is what goes over it, `client.ts` and `tui.ts`
  are the client, and `cli.ts` is `pier`.
- `experiments/gate/` holds the gate: real Claude Code turns against a Durable Harness,
  each step in its own process so it can be killed.
- `experiments/wire/` measures what a conversation watch sends.
- `experiments/transcript/` measures the terminal client with a long transcript.
- `test/` holds offline tests, with a faux model in place of Claude: the daemon and its
  clients over a real socket, the prompt, and the provider's loading.
- `todos/` holds specs for work not yet done.
- `docs/vision.md` says what pier is for, and how it changes as p3 does.
- `docs/principles.md` holds the principles all work on pier keeps to.
- `docs/releasing.md` says how release-please makes versions.
- `docs/history.md` records Will's decisions, the gate's findings and the wrong turns.
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
  session id. pi does that when a session ends; Durable never does.
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

## Known gaps

- A tool call has no timeout unless the model sets one: Durable's bash has no default.
- One environment per conversation: two panes in different shells on one conversation
  take turns deciding it.
- `pier` (continue) scans up to 500 conversations each time.
- The protocol has no backpressure: a slow client's socket buffers.
- The socket is chmodded to 0600 just after it starts listening; in its 0700 directory
  that gap doesn't matter.
- The prompt loads skills from pi's default locations only: `createPrompt()` takes
  `skillPaths`, but the daemon passes none, so skills listed in `settings.json`
  (dotfiles adds ketch's there) don't reach pier's Claude (read from the code,
  2026-11-16).
- Not tried with real Claude: steering a run (Enter while Claude works) through
  pi-claude-code, and images.

## Versions

pi's packages are pinned exactly in `package.json`, all to one release (1.5.2). Pi
Durable is experimental, and breaking changes land in minor releases, so bump them
together and deliberately: read their changelogs, then run the tests and the gate.

pier doesn't follow the pi that nixpkgs ships (1.5.0 on 2026-11-12). Its packages come
from its own lockfile, so nothing ties the two together. What pier shares with classic
pi is `~/.pi/agent`: settings and credentials.

pi-claude-code isn't on npm. It's pinned to a commit, as a GitHub tarball
(`codeload.github.com`), so installs need no git and no SSH key.

## License

MIT
