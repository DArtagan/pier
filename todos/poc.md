# The proof of concept: one daemon per host, thin clients

## Opening prompt

> Read `todos/poc.md`, then do step 2: the daemon and the protocol, as decided in
> `todos/wire-format.md` (if that file still exists, Will hasn't decided yet: ask). Build
> a daemon that opens one Harness on SQLite with the shim (`shim.attach(harness)`
> included), listens on a Unix socket in `$XDG_RUNTIME_DIR`, and serves several
> conversations to several clients at once, with each client's environment passed
> through. A headless client that drives it is enough for this step; the TUI is step
> 3. Update this spec as facts change.

Moved here from dotfiles' `todos/pi-durable.md` on **2026-10-29**, when step 1 passed.
That file now tracks only the Nix side (packaging and the home-manager module).
Facts under *What exists* were first read from source on 2026-10-28 (pi **v1.4.0**,
pi-claude-bridge **0.9.3**) and still held on 2026-10-29: nixpkgs and npm both still
ship 1.4.0 and 0.9.3.

## Why

Will's words, 2026-10-28:

- *"I'd like to move in the direction of using Pi Durable, for the purposes of
  abstracting apart the interface and the harness. Eventually allowing me to
  interface from terminal, web, and mobile. And build more isolation around
  agents' environments. Eventually this could become an orchestration platform
  as well."*

## Decided

Will's words, 2026-10-28:

- *"I'm okay with dropping or rebuilding all of the extensions, except for
  pi-claude-bridge - that one's indispensable to my set-up."*
- *"For a first proof-of-concept version, I'd be looking to get to
  as-close-as-possible to the vanilla pi experience/flows, but built on Durable."*
- Asked whether tmux panes could share *"one user-wide service that's running the
  durable pi process and owning the storage"*, and on hearing yes, asked for this
  spec. So: **one daemon per host, owning the storage; every pane is a client.**

Will, 2026-10-29: build the implementation in its own repo in `~/repositories`,
*"keep the git repo local for now"*, set up like dotfiles (devenv, linters, tests,
`todos/`, MIT). That's this repo, named pier by Claude.

Will, 2026-10-29, on the proposals below:

- One storage: *"Yes, one SQLite for all conversations"*.
- The environment: *"Yes, for now keep it simple by passing through the whole
  environment. We can refine it later."* (`SSH_AUTH_SOCK` included, despite the
  conflict with dotfiles' `todos/ssh-agent.md`.)
- `/quit`, `/exit`, `/detach` as proposed under "Daemon behaviour": *"Yes, those
  definitions are fine for quit, exit, detach."* What Ctrl+C on an empty prompt does
  is still open.
- The transport: *"I don't know enough to make a decision here - please describe out
  the option space for me."* Laid out, with the wire format, in
  `todos/wire-format.md`, waiting on his answers.

Proposed on 2026-10-28 and not objected to, but not explicitly signed off: the build
order below.

## Step 1, the bridge gate: passed 2026-10-29

`npm run gate` (`experiments/bridge-gate/`) ran pi-claude-bridge 0.9.3 on a Durable
1.4.0 Harness (SQLite, pi's `ModelRuntime`, `CodingTools`, the shim), against real
Claude Code 2.1.311 on `claude-bridge/claude-opus-5-5` (sent to Claude Code as
`claude-opus-5-5[1m]`), thinking `low`. **33/33 checks passed**, and 40/40 once Esc was added. (The gate's first
version ran every step in a fresh process. The bridge then never had state to get
wrong, so its compaction and fork checks proved nothing. It now runs related steps in
one process.) What held:

- **A turn with tools.** write, read and bash, through the bridge's MCP tools, with no
  tool errors.
- **kill -9 mid-tool.** The host's whole process group was killed while
  `sleep 20; echo done > slept.txt` ran, the way systemd's control-group kill would. The
  storage was reopened in a new process and `resume()` called. The turn finished
  unprompted: bash came back `interrupted`, the bridge rebuilt Claude Code's session
  from Durable's history and sent its "session was interrupted and resumed" prompt, and
  the model said the file was never created and offered to rerun the command. Nothing
  was left running.
- **Compaction mid-conversation.** The summary went through the bridge's isolated path,
  the shim marked the rewrite, the bridge rebuilt its session (`Case 4`) rather than
  resuming stale history, and the next turn recalled what had been summarized.
- **Fork.** The fork got its own provider session id. Root and fork alternated in one
  process, and each answered from its own history. Each branch's second turn
  *resumed* its own Claude Code session, so per-session state stays apart in one
  process.
- **Prompt cache.** A second turn in the same process resumed Claude Code's session
  (`reuse`, 90–92% of input tokens read from cache).
- **Instructions.** A marker instruction in the workspace's AGENTS.md, which the model
  never read through a tool, ended every answer. So the context files reached Claude
  Code through the bridge's prompt capture on every turn, including after a restart, a
  compaction and a fork.
- **Esc mid-tool** (added later on 2026-10-29, 40/40 checks). The conversation was aborted
  while `sleep 30` ran, so no request was streaming. The bridge closed its Claude Code
  query and nothing was left running. The next turn in the same process was a fresh
  query, which rebuilt Claude Code's session, and not one re-entering a parked query.
- **No prompt-capture failure, no "out of extra usage"**, no assistant errors and no
  Harness reports, across every run.

What it took, and what was wrong in the original plan:

- **Durable aborts a task invocation's signal when the invocation ends**, normally too
  (`scheduler.ts`, `#end`). The bridge ties a Claude Code query parked at a tool round
  to the signal of the request that started it, so every turn died at its first tool
  round ("Operation aborted"). The plan didn't foresee this. The shim now gives the
  bridge one signal per session and run. It forwards an abort only while a request is
  streaming, and ends the signal itself when the conversation's run ends (it follows
  the Harness's commits for `pi.live`). Without that second part, Esc during a tool
  round left Claude Code running, and the next turn re-entered beside it (a control run
  showed both).
- **`session_start` must not use the reasons `new`, `resume` or `fork`.** For those,
  the bridge clears every session's state (`clearSession`), not just the one starting.
  The shim uses `startup`. The original plan said to use all three.
- **The rewrite mark is essential.** In a control run without the shim's
  `session_compact`, the turn after compaction went down the bridge's `clean-start`
  path, and the model said it had no history.
- **`session_before_compact` and `session_tree` aren't needed.** Durable sends summaries
  with the conversation's session id, which the bridge's cwd lookup falls back to. A
  Durable fork is a new conversation with a fresh session id.
- **The capture key matches by construction.** The shim keys the prompt with the
  bridge's own `toBridgeContext` over the same messages. The prompt (`src/prompt.ts`)
  leaves out pi's preamble entirely; Claude Code uses its own preset.
- **The bridge loads outside pi**, from npm, with jiti. That bridge differs from
  dotfiles' build only by `multi-session-registration.patch`, which doesn't matter
  when one copy is loaded.

## Not yet checked from step 1

- **Killing only the daemon's process**, not its group. Claude Code and the tools'
  children would be orphaned; a `sleep; echo` would still write its file. The systemd
  unit should keep `KillMode=control-group`.
- **Steering mid-run** (`whenBusy: "steer"`) through the bridge. The bridge has a path
  for steers delivered with tool results; untested on Durable.
- **Thinking above `low`**, images, and the settings.json `skills` paths (the prompt
  only loads pi's default skill locations so far).
- **Scale:** the shim's per-session maps never shrink, and each active session holds
  a Claude Code process.

## What exists

### Pi Durable is a library, not a mode of pi

- `@earendil-works/pi-durable` shipped with pi 1.0 (2026-10-01), marked
  **experimental: "The API changes without notice between releases."** It is a
  harness (storage, tasks, conversations, extensions, compaction), not an app.
  Announcement: <https://earendil.com/posts/pi-durable>. README and examples:
  `packages/durable/` in <https://github.com/earendil-works/pi>, and in nixpkgs'
  build (see `CLAUDE.md`).
- **The coding agent (`pi`) does not use it.** `packages/coding-agent/package.json`
  doesn't depend on it.
- **There is no first-party server or client.** pi 1.2.0 removed "the unreleased
  experimental server, client, and plugin stack" and the `pi-client`,
  `pi-protocol` and `pi-server` packages (coding-agent `CHANGELOG.md`, 1.2.0).
- **Breaking changes land in minor releases.** 1.4.0 removed `TaskRuntime.sleep()`,
  made `checkpointWhen` mandatory on documents, and migrates SQLite storage to a
  schema 1.3.0 can't open (durable `CHANGELOG.md`).

### The v1.0.0 demo: a coding agent on Durable, with pi's TUI

At tag `v1.0.0`, `packages/coding-agent/src/experimental/durable/` held a small
coding agent on Durable (removed in 1.2.0 with the server stack). Files:
`main.ts`, `runtime.ts` (14 KB), `tui.ts` (25 KB), `prompt.ts`, `subagent.ts`,
`sessions.ts`, `harness-setup.ts`, `README.md`. Its README:

- It reused pi's model runtime, auth, settings, system prompt, keybindings,
  theme, and interactive components. The agent was the Harness with Durable's
  built-in `CodingTools`.
- Kill it mid-tool, restart with `--continue`, and the turn finishes: "Nothing in
  the TUI handles recovery; it only renders the conversation view."
- It had streaming, tool output, steer/follow-up/Esc, `/model`, thinking levels,
  `/compact`, subagents with an `/agents` switcher, and a task-graph panel.
- It lacked a session picker, forks and tree navigation, extensions, prompt
  templates, images, and `/login`.
- `runtime.ts` passed pi's `ModelRuntime` to the Harness as `models` (pier does the
  same), and split rendering from control with plain `DurableView` /
  `DurableController` interfaces. That split is where a network transport goes.
- One SQLite file per session, with a lock file to keep a second process out.

### Pieces in pi 1.4.0 to reuse

- **pi-tui** (`@earendil-works/pi-tui`) is a general terminal UI toolkit: an
  editor, Markdown, select lists, overlays, images. It has no agent dependencies.
- **The coding agent exports its interactive components "for extensions"**
  (`packages/coding-agent/src/index.ts`, around lines 435–490):
  `AssistantMessageComponent`, `UserMessageComponent`, `ToolExecutionComponent`,
  `BashExecutionComponent`, `CustomEditor`, `FooterComponent`,
  `ModelSelectorComponent`, `SessionSelectorComponent`, `TreeSelectorComponent`,
  `renderDiff`, and the theme functions (`initTheme`, `getMarkdownTheme`, …).
  They take plain pi-ai message types, which Durable stores in its transcript.
  **Not exported:** `createAllToolRenderers` and `WorkingStatusIndicator`, both
  of which the demo used.
- **Also exported:** `ModelRuntime`, `SettingsManager`, `KeybindingsManager`,
  `DefaultResourceLoader`, `loadProjectContextFiles`, `loadSkills`,
  `formatSkillsForPrompt`, `ExtensionRunner`, `discoverAndLoadExtensions`. pier's
  prompt already uses `loadProjectContextFiles` and `loadSkills`.
- **Watching:** `Conversation.viewState()` (a Chord replicated state),
  `watch()` (the exact operations of each commit, "small enough to send over a
  socket"), and `watchEvents()` (coding-agent-style events on top of a snapshot;
  the gate uses it). Late joiners and reconnects start from a fresh snapshot; a
  consumer more than 100 frames behind gets a fresh snapshot instead.
- **Chord** (`@earendil-works/chord`) has links over memory, Node IPC and
  WebSocket (`webSocketLink`, `acceptWebSockets`), and its replicated state
  ships to remote viewers as a snapshot plus deltas. It runs in Node and
  browsers. It's the obvious transport; nothing here has tried it yet.
- **Isolation, for later:** `@earendil-works/pi-env` runs tools on another
  machine through a small Rust daemon over SSH, while the harness and
  credentials stay local. Gondolin runs QEMU/krun micro-VMs. Durable's `env`
  callback builds an environment per tool call from the conversation, so each
  conversation can get its own sandbox (example `29-sandbox-per-conversation.ts`).

### How Durable lines up with the bridge

- **Session id:** each conversation has a persisted UUIDv7 (`pi.provider`) that
  Durable sends to pi-ai as `sessionId`. It survives reopen, retries, reset,
  compaction and model changes; a fork or child gets a fresh one. It's the key the
  shim and the bridge use.
- **Compaction** sends `cacheRetention: "none"` with the conversation's `sessionId`
  (`durable/src/harness/compaction.ts:177–181`), so it takes the bridge's isolated
  summary path (verified). It runs in the background while the conversation
  continues; the summary is placed at the next turn boundary.
- **Prompt:** built from extension sections and stored as positional `system`
  messages in the transcript; only what changed is sent again. `beforeRequest` on
  `GenerationTask` sees the request's messages, system messages included, just before
  the model call (`generation.ts:220–231`).
- **Crash recovery:** a cut-off model request is sent again, with the partial
  answer kept and marked aborted. A cut-off tool call reruns only if declared
  `replay: "safe"`; otherwise the model gets an `interrupted` result (verified for
  bash).
- **Tool environment:** `new NodeExecutionEnv({ cwd, shellPath?, shellEnv? })`.
  `shellEnv` is layered over `process.env`. The `env` callback receives the
  conversation id, its `cwd` and committed reads.
- **Storage:** one process owns a storage, with no locking between processes. A
  storage error closes the whole Harness; `harness.closed` tells the host to reopen.
  A task cut off by crashes 5 times in a row is parked (`settings.restartLimit`).
- **Tool ordering:** `settings.toolExecution: "sequential" | "parallel"` replaces
  dotfiles' `modules/pi/sequential-file-tools.ts`, though it's coarser.

### Prior art, not adopted

[disler/durable-pi](https://github.com/disler/durable-pi) has a per-device
backend (`dpi-backend`, HTTP plus server-sent events, bearer token, one SQLite
file per session plus a catalog), a web hub, a pi-style `dpi-tui` on pi-tui
1.0.3, and a curl API. It is set up for OpenRouter, Node 24, `just` and zsh. Its
API and SDK (`apps/dpi-sdk`) are worth reading for wire-protocol ideas.

## Architecture

```
tmux pane: pi (thin client) ─┐
tmux pane: pi (thin client) ─┼─ Unix socket ($XDG_RUNTIME_DIR) ─┐
later: web / phone ──────────┘   WebSocket on tailscale0, auth ─┤
                                                                 ▼
                    systemd user service (one per host, under home-manager)
                    Harness + SQLite storage (all conversations)
                    ModelRuntime + pi-claude-bridge (through the shim)
                    env(conversation) → NodeExecutionEnv({ cwd, shellEnv })
                    later: pi-env / Gondolin per conversation
```

- **One storage for all conversations** is Durable's native layout: forks and
  subagents just work, and `/resume` lists conversations filtered by cwd. The
  cost: a storage error drops every pane at once until the service restarts and
  Durable resumes. If that's too coarse, fall back to one Harness per session
  file inside the same process (as durable-pi does).
- **Clients never open the storage.** All reads and writes go through the daemon.
- **A systemd `.socket` unit** could start the daemon when the first pane
  connects.

### Wrong turn, corrected (2026-10-28)

The first plan was one process per pane, with one SQLite file per session (as
the v1.0.0 demo did), so several panes could run pi at once. That works, but it
puts the harness back in the interface process, against the whole point. The
daemon solves multi-pane properly, so per-session files are only a fallback for
isolating failures.

## Build order

1. ~~**Headless bridge test.**~~ Passed 2026-10-29; see above.
2. **The daemon and the protocol.** The wire format and transport options are in
   `todos/wire-format.md`, waiting on Will. Pass the client's environment through
   (below). A headless client is enough to prove it.
3. **The TUI client.** Port `tui.ts` from v1.0.0 to Durable 1.4.0. Load settings,
   keybindings and theme with pi's exported managers.
4. **Vanilla parity.** Build in this order:
   - the prompt: pi's system prompt sections, AGENTS.md, and skills (ketch's
     included), from `DefaultResourceLoader` and `loadSkills`. Started in
     `src/prompt.ts`. Keep pi's preamble and its docs paths out of anything the
     bridge forwards: the bridge refuses to send them, because Claude Code's
     subscription gate reads them as a third-party app.
   - `/new`, `/resume` picker, `--continue`
   - `/fork`, `/tree`
   - the footer (tokens, cost, context, quota)
   - tool renderers
   - `!` bash
   - `@file` autocomplete
   - image paste

   Out of scope for the PoC: `/login` (log in with pi itself; credentials are
   shared), loading arbitrary pi extensions, `/share` and `/export`, prompt
   templates.
5. **Packaging**, in dotfiles: `pkgs/pier`, pinned to the pi version nixpkgs
   ships, and a module under `modules/pi/` next to the classic setup, which stays
   installed throughout. Tracked in dotfiles' `todos/pi-durable.md`.

## Daemon behaviour that differs from vanilla pi

- **Environment.** Vanilla pi's bash inherits the pane's shell: devenv/direnv
  `PATH`, `nix develop`, `SSH_AUTH_SOCK`. A service gets systemd's, which is the
  problem dotfiles' `modules/pi/remote.nix` patches over for agegr.
  - Decided: the client sends its whole environment on attach, the daemon stores
    it in a conversation document, and `env` passes it as `shellEnv`. Refresh it on
    every attach, so devenv changes take effect. Refine later.
  - `GIT_CONFIG_GLOBAL` (the agents' git config without difftastic) goes in the
    unit, as `remote.nix` does.
- **The bridge's debug log** defaults to pi's `~/.pi/agent/claude-bridge.log`. Give
  the daemon its own with `CLAUDE_BRIDGE_DEBUG_PATH`.
- **SSH agent.** A session given the pane's `SSH_AUTH_SOCK` keeps signing access
  after you detach, while that socket lives. This conflicts with the
  per-terminal approval in dotfiles' `todos/ssh-agent.md`; settle it with that spec.
- **Closing a pane doesn't stop the agent.**
  - Decided (Will, 2026-10-29): `/quit` keeps vanilla semantics (it ends the
    session's running turn), `/exit` keeps waiting for the turn as dotfiles'
    `modules/pi/exit.ts` does, and a new `/detach` leaves it running.
  - Decide what Ctrl+C on an empty prompt does. The demo exited at once and left
    the work running.
- **Restarts interrupt every pane.** home-manager restarts a changed user service
  on switch. Durable resumes everything (the gate showed a turn finishing after a
  kill), but bash and other tools not safe to rerun come back as "interrupted".
  Configure the unit so switches don't restart it (the exact home-manager setting
  is unchecked), and restart it deliberately when idle.
- **Gained:** two panes on one session both see it live and can both steer it.
- **Resources:** each active turn's Claude Code child process lives in the
  service's cgroup, so a memory limit or restart affects every session.
- **One daemon per host.** The Steam Deck gets its own. Reaching another host's
  sessions comes with the tailnet listener.

## Not checked

- How much of the v1.0.0 `tui.ts` / `runtime.ts` still compiles against 1.4.0.
- Chord as the transport: see `todos/wire-format.md`. (Earendil's v1.1.0 stack served
  `viewState()` directly as a Chord service, so it can be done; Chord's API has
  changed since.)
- Whether Durable's `CodingTools` output renders well in the coding agent's
  `ToolExecutionComponent` without its renderers.
- How the bridge's Claude Code process count and memory scale with many idle
  sessions in one process.

## Done when (PoC)

- `pi` in two tmux panes, in two projects, runs two sessions at once through one
  daemon, with the devenv environment each pane had.
- A claude-bridge turn with tools, interrupted by `systemctl --user restart`,
  finishes after the restart without being asked again.
- The flows used day to day work as in vanilla pi: prompt, steer, follow-up, Esc,
  `/model`, thinking, `/compact`, `/new`, `/resume`, `/fork`, `/tree`, `!`, `@file`.
- Classic `pi` still works alongside it.

When it lands, the setup goes in `README.md` here and in a dotfiles module README,
and this file and its entry in `todos/README.md` are deleted.
