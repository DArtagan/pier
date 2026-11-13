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
pi-claude-bridge **0.9.3**). **Re-checked 2026-11-12** against pi **1.5.2** and
pi-claude-bridge **0.12.0**, which pier now pins, from their changelogs and source (a
read-only clone of each at its tag). The gate passed again; what changed is marked
"(1.5)" or "(bridge 0.10–0.12)" below. nixpkgs ships pi 1.5.0 by then.

## Open questions (2026-11-12)

New since the decisions below; Will's to answer, alongside `todos/wire-format.md`:

1. **pier, or Earendil's Pi Roam?** Earendil is designing exactly this project in
   the pi repo (see "Earendil's own direction" below): p2, a working but
   explicitly throwaway prototype, and p3 ("Pi Roam"), its successor, still a design
   discussion. Options: carry on with pier as planned (recommended: p3 has no code
   and no timeline, and can't load pi-claude-bridge); keep pier deliberately small
   until p3 shows its shape, aiming to move onto it; or pause. The PoC's value holds
   either way: daily use, and knowing the bridge on Durable.
2. **pi-claude-bridge, or Earendil's pi-claude-code?** Will called the bridge
   indispensable (2026-10-28). Earendil now has its own Claude Code provider,
   `@earendil-works/pi-claude-code` (below), which runs on Durable with no shim at
   all: a smoke test on 2026-11-12 answered a tool turn and a follow-up through it.
   The bridge is the proven, fuller option and stays the default; pi-claude-code
   would remove `src/bridge/` entirely. Worth a gate run of its own if Will wants to
   weigh it.

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

## Step 1, the bridge gate: passed 2026-10-29, again on 1.5.2 on 2026-11-12

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

**Re-run 2026-11-12 on pi 1.5.2 and pi-claude-bridge 0.12.0: 42/42.** Same steps, with
these differences:

- **The crash step was partly vacuous before.** It killed the host as soon as the
  bash call showed as running. In 1.5 that status is a deferred commit made *before*
  the call's intent is stored and the tool starts (`tool.ts`), so the first 1.5 run
  killed it before the call. The call then rightly ran in full after the restart. The
  gate now waits until the `sleep` process exists, and checks that the cut-off call
  came back `interrupted` and wasn't run again. It did. In 1.4.0 the same early kill
  probably happened too, which made "nothing was left running" vacuous.
- **Tools run in process groups of their own** (`NodeExecutionEnv` spawns `detached`,
  in 1.4.0 as well), so killing the host's process group left
  `bash -c 'sleep 20; echo done > slept.txt'` running. It wrote its file after the
  turn had been told it was interrupted. Only a control-group kill reaps it. The gate
  now kills everything in the workspace as well, and notes what a group kill alone
  leaves. For the daemon, `KillMode=control-group` is essential, not just sensible.
- **The bridge keeps Claude Code's session across restarts** (bridge 0.10–0.12: it
  compares message content and persists per-session state in
  `<agent dir>/claude-bridge/sessions/`). After the crash it wrote only what was
  missing (`prefix-write`), instead of re-importing everything.
- **The rewrite mark is no longer load-bearing.** The control run without it now
  recalled the summary's facts: the bridge sees the rewritten history by itself. The
  shim still sends it.
- **The gate runs on an agent dir of its own** (`PI_CODING_AGENT_DIR` under its
  state dir, with a copy of `claude-bridge.json`), so the bridge's persisted state
  stays out of `~/.pi/agent`.

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
- **`session_start` must not use the reasons `new`, `resume` or `fork`** (bridge 0.9.3).
  For those, the bridge cleared every session's state (`clearSession`), not just the
  one starting. The shim uses `startup`. The original plan said to use all three.
  Since bridge 0.11 `clearSession` keeps every session's state, and `fork` with a
  `previousSessionFile` lets a fork start from its parent's Claude Code session
  (keeping the prompt cache). That file must be a pi JSONL session whose header names
  the parent's id, so the shim would have to write one; not done.
- **The rewrite mark was essential** with bridge 0.9.3. In a control run without the
  shim's `session_compact`, the turn after compaction went down the bridge's
  `clean-start` path, and the model said it had no history. Bridge 0.12 no longer
  needs it (above).
- **The bridge still needs the shim's per-run signal** (bridge 0.12). It now binds a
  *later* request's signal only while that request streams, for hosts that abort each
  request's signal when it ends. But it still ties the query to the signal of the
  request that started it unconditionally (`onAbort`, `index.ts` around 2106).
- **`session_before_compact` and `session_tree` aren't needed.** Durable sends summaries
  with the conversation's session id, which the bridge's cwd lookup falls back to. A
  Durable fork is a new conversation with a fresh session id.
- **The capture key matches by construction.** The shim keys the prompt with the
  bridge's own `toBridgeContext` over the same messages. The prompt (`src/prompt.ts`)
  leaves out pi's preamble entirely; Claude Code uses its own preset. Bridge 0.12
  dropped its guard against pi's preamble ("pi 1.5's prompt no longer trips
  Anthropic's third-party billing check"), but still forwards only the prompt's
  portable parts.
- **The bridge loads outside pi**, from npm, with jiti. pier takes 0.12.0, which needs
  pi 1.5.1 or newer; dotfiles runs 0.11.0 on nixpkgs' pi 1.5.0, patched with
  `multi-session-registration.patch`, which doesn't matter when one copy is loaded.
  0.11.0 moved AskClaude to its own package, so the bridge registers no tool.
- **The bridge adds a 120 s default to bash calls** through pi's `tool_call` event
  (bridge 0.10), which Durable doesn't have. Durable's bash has no default timeout,
  so a call without one runs until it ends or the run is aborted. Not handled yet.

## Not yet checked from step 1

- **Killing only the daemon's process.** Checked for its group instead (above): tools
  outlive it. Claude Code would too.
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
  schema 1.3.0 can't open (durable `CHANGELOG.md`). 1.5.0 had about two dozen
  breaking changes; the ones that touch pier are below. `pi.live` is at version 3, so
  a 1.4 Harness can't read a conversation 1.5 wrote to.
- **1.5, what matters to pier:**
  - `watchEvents()` and `Conversation.viewState()` are gone. Clients render state:
    `Conversation.watch(context, window?)`, whose listener takes
    `{ kind: "value", value, ops }`. Earendil's reason: "a renderer renders state
    instead of assembling it from events … new information becomes a field there
    rather than an event type every client must learn".
  - The view's `entries` are a **window** (the newest 50, at most 100), not the whole
    active context. `ConversationTranscript` keeps a client's transcript over it,
    pages older entries, and resumes after a dropped connection with only what was
    missed (`conversation.watch(context, transcript.resume)`).
  - Deliveries fold the commits made while the listener runs; past 10,000 pending
    operations, one whole-value replacement (was 100 frames).
  - `subscribeCommits()` is `observeCommits({ advance, end })`, and sees only stored
    commits. Streamed text, tool output and a tool's `running` status are stored
    late, at the latest after `settings.progress.persistWithinMs` (1 s): watches show
    them at once, and a crash loses up to about a second of them.
  - A model request in flight when the host dies is **no longer resent** on open: it
    counts as a failed attempt under `settings.retry`, and with no retry left the run
    ends with `pi.live.runFailure` reason `interrupted`.
  - A task cut off `restartLimit` times **ends** instead of parking; `retryTask()` is
    gone.
  - New: `pi.live.runFailure` (why the last run ended unanswered),
    `submit({ type: "continue" })` (carry on after a failure), `whenIdle: "reject"`,
    per-conversation `maxTurns` and compaction settings, `afterRun` hooks, and
    `HarnessOptions.readOnly`.
  - Group commit: one Harness served 128 conversations about 30% faster on local
    SQLite, and the scheduler no longer slows with the number of conversations
    (2048: 88 to 459 runs/s on SQLite). That favours one Harness for every
    conversation, as decided.
  - Tool schemas are JSON Schema, through `@earendil-works/pi-schema`; pi-ai no
    longer re-exports TypeBox.

### Earendil's own direction: p2 and p3 ("Pi Roam")

Found 2026-11-12 in the pi repo at v1.5.2, `apps/`. Neither is published.

- **p2** is "a self-hosted Pi Durable UI built from independent Chord plugins": a web
  UI and a TUI, a session worker process per session with its own store,
  owner sign-in (one-time links, an owner key in a 0700 data dir, cookies, device
  pairing), remote access through an HTTPS tunnel or Earendil's Radius relay, and
  remote environments. Its README: **"p2 is a prototype. It will be gone soon. …
  Do not build on it."** Its TUI launcher needs Node 26.5.1 or newer, for the sandbox
  it runs the server's TUI code in. It doesn't load pi extensions.
- **p3**, or "Pi Roam", is its successor, still docs only (`apps/p3/docs/`,
  `status-2026-11-09.md`, `direction-pi-roam.md`): "your own Pi instance, fully
  extensible", with Radius for backups and remote access, built on Chord v2's app
  kit. Its harness design composes Durable extensions through registries, filters,
  chains and wraps, and treats the old coding agent's extension API as "a catalogue
  of what users wanted, not a model". So pi-claude-bridge wouldn't load there as it
  is either.
- Both are what pier wants to be, from the people who make Durable. See Open question
  1, and `todos/wire-format.md` for what they mean for the protocol.
- p3's notes on efficiency are worth reading before building the daemon: p2's
  workers used 170–290 MiB each, and a page switch fetched 1.5 MiB until objects
  were held once per page and lists paged (`apps/p3/docs/efficiency.md`).

### Earendil's Claude Code provider: pi-claude-code

`@earendil-works/pi-claude-code` 0.1.0 (<https://github.com/earendil-works/pi-claude-code>,
installed from git, not npm; "Experimental"). It routes requests through `claude -p`
in stream-json mode with Claude Code's own login. pi runs the tools, through an inert
MCP inventory, and a loopback relay forwards exactly one Anthropic request per turn.
Its extension is one `pi.registerProvider()` call, with no session events, and it
imports only pi-ai at runtime. It has a usage-credit guard: a turn billed to Extra
Usage fails unless `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS` is set.

Smoke test, 2026-11-12: `models.registerNativeProvider(createClaudeCodeProvider())` on
a Durable 1.5.2 Harness with `CodingTools` and pier's prompt, model
`claude-code/claude-opus-5-5`. Auth came from Claude Code's Max login. A turn with bash
and read answered, with the AGENTS.md marker; a follow-up answered from the history
(cache read 2,004 of 2,883 input tokens). Not tested: crash, Esc, compaction, fork.
The bridge's own notes (`diag/EXTRA-USAGE-400.md`) report this route passing
Anthropic's subscription check with pi's prompt verbatim.

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

### Pieces in pi to reuse

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
- **Watching** (1.5): `Conversation.watch()` and `ConversationTranscript` (above).
  The operations are Chord's delta codec (`@earendil-works/chord/delta`).
- **Chord** is v2 since 1.5.1; v1, which the earlier report described, is removed.
  v2 has an app kit (`@earendil-works/chord/app`): an HTTP and WebSocket server,
  owner sign-in and sessions, workers, plugins with hot reload, and web and terminal
  surfaces. p2 runs on it. See `todos/wire-format.md`.
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
- **Crash recovery:** a cut-off model request is a failed attempt, retried under
  `settings.retry` (1.5; it was resent before), with the partial answer kept and
  marked aborted. A cut-off tool call reruns only if declared `replay: "safe"`;
  otherwise the model gets an `interrupted` result (verified for bash, 1.4 and 1.5).
  A call whose intent wasn't stored yet hadn't started, and runs normally.
- **Tool environment:** `new NodeExecutionEnv({ cwd, shellPath?, shellEnv? })`.
  `shellEnv` is layered over `process.env`. The `env` callback receives the
  conversation id, its `cwd` and committed reads.
- **Storage:** one process owns a storage, with no locking between processes. A
  storage error closes the whole Harness; `harness.closed` tells the host to reopen.
  A task cut off by crashes 5 times in a row ends (`settings.restartLimit`; 1.5, it was
  parked before).
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
  file inside the same process (as durable-pi does). Earendil's p2 goes further, with a
  worker process and store per session (crash isolation, at 170–290 MiB a worker);
  Durable 1.5's group commit and scheduler work make one Harness for many
  conversations cheaper than before.
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
3. **The TUI client.** Load settings, keybindings and theme with pi's exported
   managers. References: v1.0.0's `tui.ts`, which rendered `viewState()` (gone in
   1.5, so a port means moving it to `watch()` and `ConversationTranscript`), and
   p2's TUI (`apps/p2/src/hosts/tui.ts` and its plugins' `tui.ts` facets), which is
   current but built on Chord v2.
4. **Vanilla parity.** Build in this order:
   - the prompt: pi's system prompt sections, AGENTS.md, and skills (ketch's
     included), from `DefaultResourceLoader` and `loadSkills`. Started in
     `src/prompt.ts`. The bridge forwards only the portable parts (context files,
     skills, custom sections), so pi's own sections matter only if pi-claude-code
     (Open question 2) or another provider is used.
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
5. **Packaging**, in dotfiles: `pkgs/pier`, built from pier's own lockfile, and a
   module under `modules/pi/` next to the classic setup, which stays installed
   throughout. Tracked in dotfiles' `todos/pi-durable.md`.

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
- **Stopping:** tools run in process groups of their own, so only the service's
  control-group kill (systemd's default `KillMode=control-group`) reaps them when
  the daemon dies or stops. Otherwise an interrupted command runs on, and its
  effects land after the agent was told it was interrupted (gate, 2026-11-12).
- **One daemon per host.** The Steam Deck gets its own. Reaching another host's
  sessions comes with the tailnet listener.

## Not checked

- Chord v2 as the transport: see `todos/wire-format.md`. p2 shows it can carry
  Durable views; nothing here has tried it.
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
