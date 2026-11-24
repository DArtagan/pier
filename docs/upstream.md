# Earendil's pieces, as last read

What pier relies on from Earendil, and where Earendil is going. `AGENTS.md` has the
constraints work must respect; this has the facts behind them, and the direction that
decides how long pier's parts last (`docs/vision.md`). It says what's true of the
versions pier runs; an update replaces what changed (`docs/updating.md`).

## Pi Durable, as pier uses it

Read from Durable 1.6.0's source and changelogs (a clone at `v1.6.0`), 2026-11-23.

- **A library, not an app.** A harness: storage, tasks, conversations, extensions,
  compaction. The coding agent (`pi`) doesn't use it, and pi 1.2.0 removed the
  unreleased first-party server and client. Marked experimental: "The API changes
  without notice between releases."
- **A store doesn't go back.** Documents carry versions, and a Harness can't read
  versions newer than its own: `pi.live` is at 3, `pi.tool` at 4 and `pi.generation` at
  3. A store a newer pier has written isn't meant to be opened by an older one, so roll
  back pier's code, not its store. Minor releases have moved them before (1.4.0
  changed SQLite's schema; 1.5.0 had about two dozen breaking changes).
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
    gets an `interrupted` result (seen for bash, in the gate). A call whose intent
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
- **Provider resources** (#11961): `harness.close()` joins its tasks, then calls
  `cleanupSessionResources(id)` for every provider session id its tasks used, and only
  those, so another Harness in the process keeps its own. Nothing releases one when a
  conversation idles; pier's daemon does, after five minutes. pi-ai also exports the
  registry as `@earendil-works/pi-ai/session-resources`. pi-claude-code, loaded
  through jiti, registers its cleanup on the same pi-ai module instance Durable calls.
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
- **Suspendable work**, which `docs/vision.md` counts on for long-running work:
  - Signals: `defineSignal()` defines a typed value that `harness.signal(taskId, …)`
    delivers to a task from outside; a sleep can wait for signals, a time, or both.
  - A tool's `execute()` can return a park (`{ sleep }` or `{ wait }`) instead of a
    result, and runs again once woken. A parked call holds no invocation, and its slot
    shows `sleeping` or `waiting`. Examples 38–46 cover a webhook, polling, a
    subagent, an approval gate.
  - `beforeTool` hooks can park a call (gates); `afterTools` and `onYield` hooks can
    start tasks (`HookTask`); pier uses none of them.
  - `SubmissionDraft.notify` signals a task when a submission settles, and
    `onAbort: "keep"` keeps a queued input through an abort.
  - pier's client doesn't draw a parked slot yet: pier has no tool that parks.
- **`durationMs` of a tool result** runs from the tool task's first run to its
  result, hooks, parks, crash downtime and reruns included. pier passes it on to pi's
  tool component (`tool-calls.ts`).
- **`@earendil-works/pi-durable/images/fit`** fits images to a model's limits
  before they're stored, as pi does. pier doesn't take images in yet.

## pi's own pieces

- **pi-tui** is a general terminal UI toolkit (editor, Markdown, select lists,
  overlays, images) with no agent dependencies.
- **The coding agent exports its interactive components** "for extensions"
  (`packages/coding-agent/src/index.ts`), and `ModelRuntime`, `SettingsManager`,
  `KeybindingsManager`, `loadProjectContextFiles`, `loadSkillsFromDir` and
  `formatSkillsForPrompt`; pier's skills section uses the last two. pier's client uses
  the components and pi's tool definitions' renderers. Not exported: the theme
  instance and theme controller (pier imports them from `dist/` by path), the working
  indicator, the app keymap, `createAllToolRenderers`, `formatTokens`,
  `getModelSearchText`, `createInteractiveTui` and `createChatViewport` (pier rebuilds
  what it needs).
- **pi-tui's `render()`** returns `readonly string[]`, and a `Container` returns the
  same cached array while its children are unchanged, so output must be copied before
  it's changed. Enter on a menu submits only from the command-name menu; pier's
  `asPicker` sends an argument's command itself.
- **pi-claude-code** is pinned to `d5b5e04` (2026-11-05), its newest commit on
  2026-11-23.
- **Isolation, for later:** `@earendil-works/pi-env` runs tools on another machine
  through a small Rust daemon over SSH, while the harness and credentials stay local;
  Gondolin runs QEMU or krun micro-VMs. For that work to take up: pier trusts every
  project, loading its AGENTS.md and skills without asking (Will, 2026-11-17, of
  skills: "No, let's not ask"), where classic pi gates them on project trust and
  agentskills.io suggests the same.

## Earendil's direction

- **p2** (`apps/p2` in the pi repo, read at v1.5.2, 2026-11-12): "a self-hosted Pi Durable
  UI built from independent Chord plugins". A web UI and a TUI, a worker process and
  store per session (170–290 MiB each), owner sign-in, remote access through a tunnel
  or Radius. Its README: "p2 is a prototype. It will be gone soon. … Do not build on
  it."
- **p3, "Pi Roam"**, its successor (`apps/p3/` on `main`, read at `ff0e0ff17`,
  2026-11-23; still its newest p3 commit on 2026-11-24):
  - "one Pi per person", built on Chord and Durable. One owner, who installs every
    plugin; almost everything is a plugin (the harness, models, environments, coding
    tools, the prompt, the transcript, people, apps, views, Radius). Plugins can
    provide model providers, so pi-claude-code would fit as one. Its docs never
    mention Claude Code. Data in `~/.pi/p3`, starting empty.
  - Built: slice 1, sessions with a worker per session (29.5 MiB idle), and the
    release's three parts (slice 26: the build, the `p3` command, a supervisor),
    under review. The base is a skeleton (2026-11-20), with only what must exist
    before plugins load; the rest are plugins (`control`, `runner`, `sessions`,
    `sign-in`). Not yet: the harness, models or chat. Nothing on npm
    (`@earendil-works/p3` is 0.0.1, unpublished).
  - Still briefs: the terminal client scaffold (slice 27), and a conversation,
    models, environments and the prompt (slices 3, 7, 8, 9). Slice 8 settled one SSH
    connection per worker for remote environments, reused for everything.
  - **Node 26 or newer everywhere** (2026-11-18: "node 26+ all the way"), from a
    checkout and in tests; p3 ships with a Node of its own, likely as a single
    executable, as packaging work later. A Node 24 executable failed its worker memory
    budget. pier runs on Node 26 too.
  - Work is planned in Linear, one issue per package with one owner; the docs folder
    holds guides (process, building on Chord, testing, performance), with the slice
    briefs as reference. Chord, Durable and p3's base belong to Mario. No lazy loading
    in plugins for now.
  - Dates: "Colin's plan: Dec 1 Pi Roam, Dec 18 Org Devices (each member their own Pi
    on an org machine), February hosted" (decision of 2026-11-13). Whether 1 December
    means p3 or p2 under that name isn't said. "No deadline planning from agents'
    estimates" (2026-11-14).
  - Sign-in without Radius is first-class (2026-11-16): a registry of identity
    providers (Radius, this device, pairing by short code), no owner password, and
    remote requests accepted on any host name, with cookies bound to it.
  - Chord's app kit moves into p3, cut to what p3 uses (2026-11-14). Windows is a
    target.
  - **Skills** (read at `6359527`, 2026-11-17). Slice 9, the prompt (AGENTS.md, skills,
    prompt templates), is still a brief, with p2's `plugins/prompt` as its precedent.
    The plan (`archive/status-2026-11-09.md`) takes skills from three scopes, each a
    prompt section's contributor: the instance's own, the environment's (that machine's
    home), and the project's (walking up from the working directory). On a name clash
    the most specific wins. p2 does it so: one prompt plugin lists every skill, from
    its data directory's `skills`, `<cwd>/.pi/skills`, and the directories other
    plugins add to a `PluginSkills` registry (how `agent-plugins` ships
    `writing-p2-plugins`). It reads through the conversation's environment, watches
    the files, has no trust check, and reads none of classic pi's settings or packages.
    pier's `skills.ts` takes that shape: one extension lists them all, and a tool's
    extension would later add its directory, not a list of its own.
- **Radius**, Earendil's hosted service: a paid model gateway, web search, shared
  artifacts and an MCP server, closed source (radius.earendil.com/docs, 2026-11-13).
  In p2 and p3 it's also the relay for remote access, the planned home of backups, one
  of the sign-ins, and a one-click cloud machine. pier's equivalents are the tailnet
  and backing up a SQLite file.
- **Next look:** early December, against the 1 December date (`docs/vision.md`).

## Prior art

- **Where a package's skills go** (read 2026-11-17): nixpkgs settled it in
  [#547426](https://github.com/NixOS/nixpkgs/issues/547426) as
  `$out/share/skills/<pname>/<skill>/`, in the order the rest of `share/` uses (icons,
  man pages, `gsettings-schemas/<name>`). The `installAgentSkills` setup hook
  ([#558216](https://github.com/NixOS/nixpkgs/pull/558216), September 2026,
  `doc/hooks/installAgentSkills.section.md`) installs them there, and a dozen packages
  use it (herdr, hunk, worktrunk, ctx7, just, gh-stack…); ketch, gogcli and
  todoist-cli don't yet. Agents don't scan packages: the user points them at the
  directories, as home-manager's claude-code and opencode modules take `skills` paths.
  [agentskills.io](https://agentskills.io/client-implementation/adding-skills-support)
  covers the agent's side: project and user scopes, `.agents/skills` for skills shared
  between agents, user-configured paths, the project's skill winning a name, and,
  optionally, a trust check on a project's skills.

- [disler/durable-pi](https://github.com/disler/durable-pi): a per-device backend
  (HTTP and server-sent events, a bearer token, a SQLite file per session plus a
  catalog), a web hub, and a pi-style TUI. Its API and SDK (`apps/dpi-sdk`) are worth
  reading for protocol ideas.
- pi 1.0.0's Durable demo (`packages/coding-agent/src/experimental/durable/` at
  `v1.0.0`, removed in 1.2.0): a coding agent on Durable with pi's TUI. Kill it
  mid-tool, restart, and the turn finishes: "Nothing in the TUI handles recovery; it
  only renders the conversation view."
