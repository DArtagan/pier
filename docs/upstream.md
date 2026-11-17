# Earendil's pieces, as last read

What pier relies on from Earendil, and where Earendil is going, each with when it was
read. `AGENTS.md` has the constraints work must respect; this has the facts behind
them, and the direction that decides how long pier's parts last (`docs/vision.md`).
Update it when a bump or a look at p3 changes something, and date what changed.

## Pi Durable, as pier uses it

Read from Durable 1.5.2's source and changelogs (a clone at `v1.5.2`), 2026-11-12,
unless marked.

- **A library, not an app.** A harness: storage, tasks, conversations, extensions,
  compaction. The coding agent (`pi`) doesn't use it, and pi 1.2.0 removed the
  unreleased first-party server and client. Marked experimental: "The API changes
  without notice between releases." 1.4.0 changed SQLite's schema; 1.5.0 had about two
  dozen breaking changes; `pi.live` is at version 3, so a 1.4 Harness can't read what
  1.5 wrote.
- **Watching is state, not events.** `Conversation.watch(context, window?)` gives
  `{ kind: "value", value, ops }`; `watchEvents()` and `viewState()` are gone. The
  view's `entries` are a window (the newest 50, at most 100), and
  `ConversationTranscript` keeps a client's transcript over it, pages older entries,
  and resumes after a dropped connection with only what was missed. Its loader must
  pass on the page's `next` cursor: a page without one means the start is reached, or a
  gap filled, so dropping it stops paging after one page. Deliveries fold
  the commits made while the listener runs; past 10,000 pending operations, one
  whole-value replacement.
- **Shown before stored.** Streamed text, tool output and a tool's `running` status
  reach watches at once, and storage within `settings.progress.persistWithinMs` (1 s).
  `observeCommits()` sees only stored commits.
- **Crash recovery.**
  - A model request cut off by a crash is a failed attempt under `settings.retry`,
    with the partial answer kept and marked aborted; with no retry left, the run ends
    with `pi.live.runFailure` reason `interrupted`.
  - A cut-off tool call reruns only if declared `replay: "safe"`; otherwise the model
    gets an `interrupted` result (seen for bash, 1.4 and 1.5). A call whose intent
    wasn't stored yet hadn't started, and runs normally.
  - A task cut off `settings.restartLimit` (5) times in a row ends.
  - `submit({ type: "continue" })` carries on after a failure.
- **Storage.** One process owns a storage, with no locking between processes. A
  storage error closes the whole Harness; `harness.closed` tells the host. Group
  commit made one Harness for 128 conversations about 30% faster on local SQLite, and
  the scheduler no longer slows with the number of conversations (2048: 88 to 459
  runs/s), which favours one Harness for every conversation, as pier has.
- **Ids** are branded numbers from one counter shared by every record; id 1 is the
  root conversation.
- **The provider session id**: each conversation has a persisted UUIDv7 (`pi.provider`)
  that Durable sends to pi-ai as `sessionId`. It survives reopening, retries,
  compaction and model changes; a fork or child gets a fresh one. pier keys Claude
  Code's directory, and its cleanup, by it.
- **Compaction** sends `cacheRetention: "none"` with the conversation's `sessionId`,
  runs in the background while the conversation goes on, and places its summary at the
  next turn boundary.
- **The prompt** is built from extensions' sections and stored as positional `system`
  messages; only what changed is sent again. `beforeRequest` on `GenerationTask` sees
  a request's messages just before the model call.
- **Tools' environment.** The Harness's `env` callback builds one per tool call from
  the conversation (its id, `cwd`, committed reads):
  `new NodeExecutionEnv({ cwd, shellPath?, shellEnv? })`, with `shellEnv` laid over
  `process.env`. Example `29-sandbox-per-conversation.ts` gives each conversation a
  sandbox of its own. `settings.toolExecution` is `"sequential"` or `"parallel"`.
  Durable's bash has no default timeout.
- **Not yet in a release** (on `main` at `742d49fcd`, 2026-11-16), for the next bump:
  - **A store written after the bump can't be opened by pier's current Durable
    again**: `pi.tool` moves to version 4 and `pi.generation` to version 3.
  - A tool can park until an outside signal (suspendable work), which `docs/vision.md`
    counts on for long-running work.
  - `RunEndTask` is renamed `HookTask`. pier uses neither.
  - pi-claude-code was unchanged since the commit pier pins (`d5b5e04`, 2026-11-05).

## pi's own pieces

- **pi-tui** is a general terminal UI toolkit (editor, Markdown, select lists,
  overlays, images) with no agent dependencies.
- **The coding agent exports its interactive components** "for extensions"
  (`packages/coding-agent/src/index.ts`), and `ModelRuntime`, `SettingsManager`,
  `KeybindingsManager`, `loadProjectContextFiles` and `loadSkills`. Which of them fit
  pier is in `todos/tui.md`.
- **Isolation, for later:** `@earendil-works/pi-env` runs tools on another machine
  through a small Rust daemon over SSH, while the harness and credentials stay local;
  Gondolin runs QEMU or krun micro-VMs.

## Earendil's direction

- **p2** (in the pi repo at v1.5.2, `apps/p2`, 2026-11-12): "a self-hosted Pi Durable
  UI built from independent Chord plugins". A web UI and a TUI, a worker process and
  store per session (170–290 MiB each), owner sign-in, remote access through a tunnel
  or Radius. Its README: "p2 is a prototype. It will be gone soon. … Do not build on
  it."
- **p3, "Pi Roam"**, its successor (`apps/p3/` on `main` at `742d49fcd`, 2026-11-16):
  - "one Pi per person, built on Chord v2 and its app kit". One owner, who installs
    every plugin; almost everything is a plugin (the harness, models, environments,
    coding tools, the prompt, the transcript, people, apps, views, Radius). Plugins
    can provide model providers, so pi-claude-code would fit as one. Its docs never
    mention Claude Code. Data in `~/.pi/p3`, starting empty.
  - Built: slice 1, sessions with a worker per session (29.5 MiB idle). Not yet: the
    harness, models or chat.
  - Next, in order: the release (a package, `@earendil-works/p3`, with a plugin API,
    a `p3` command and a supervisor), a terminal client scaffold, sign-in with
    Radius, telemetry, applying changes, then a conversation with a faux model,
    models, environments, and the prompt (slices 26, 27, 25, 28, 2, then 3, 7, 8, 9).
  - Dates: "Colin's plan: Dec 1 Pi Roam, Dec 18 Org Devices (each member their own Pi
    on an org machine), February hosted" (decision of 2026-11-13). Whether 1 December
    means p3 or p2 under that name isn't said. "No deadline planning from agents'
    estimates" (2026-11-14).
  - Sign-in without Radius is first-class (2026-11-16): a registry of identity
    providers (Radius, this device, pairing by short code), no owner password, and
    remote requests accepted on any host name, with cookies bound to it.
  - Chord's app kit moves into p3, cut to what p3 uses (2026-11-14).
  - Re-checked later on 2026-11-16 at `ac78a60`: Windows is a target, and worker
    memory measurements for slice 7. Nothing for pier.
- **Radius**, Earendil's hosted service: a paid model gateway, web search, shared
  artifacts and an MCP server, closed source (radius.earendil.com/docs, 2026-11-13).
  In p2 and p3 it's also the relay for remote access, the planned home of backups, one
  of the sign-ins, and a one-click cloud machine. pier's equivalents are the tailnet
  and backing up a SQLite file.
- **Next look:** early December, against the 1 December date (`docs/vision.md`).

## Prior art

- [disler/durable-pi](https://github.com/disler/durable-pi): a per-device backend
  (HTTP and server-sent events, a bearer token, a SQLite file per session plus a
  catalog), a web hub, and a pi-style TUI. Its API and SDK (`apps/dpi-sdk`) are worth
  reading for protocol ideas.
- pi 1.0.0's Durable demo (`packages/coding-agent/src/experimental/durable/` at
  `v1.0.0`, removed in 1.2.0): a coding agent on Durable with pi's TUI. Kill it
  mid-tool, restart, and the turn finishes: "Nothing in the TUI handles recovery; it
  only renders the conversation view."
