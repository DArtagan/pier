# The terminal client, for daily use

## Opening prompt

> Read `docs/vision.md`, `docs/principles.md`, then `todos/tui.md`. Work through the
> candidates in the order Will chose (under "Decided"): robustness, then rendering,
> then pi's habits, which he reviews first and prunes. For each: check the facts marked
> "unchecked" first, keep it in `src/host/`, prefer pi's exported components over
> pier's own, test what can be tested offline, and try it by hand in tmux with real
> Claude. Update this spec as items land, and delete it when it's done.

Written 2026-11-16. Will's words that day: *"I'm interested in starting to improve the
TUI for day-to-day use"*, and *"Yes, start a todos/tui.md"*.

## Where this sits

- The terminal client is **host code** (`src/host/tui.ts`, `src/host/client.ts`): it's
  thrown away when p3 takes over, and p3 builds its own (slice 27, a scaffold; slice 16,
  the full client). So build what daily use asks for, cheaply, and nothing to make it
  last (`docs/vision.md`).
- **Use pi's own pieces where they fit.** pi exports its interactive components "for
  extensions", which saves writing them and makes pier look and feel like pi. Several
  expect classic pi's types (`AgentSession`, pi's session files, pi's tool
  definitions), so check each one's constructor before planning around it.
- It stays in pier, beside the daemon: clients render Durable's own view, so they
  must ship with the daemon they talk to.

## What's there now (2026-11-16)

`src/host/tui.ts`, about 350 lines on pi-tui's main-screen renderer, with pi's Markdown
and list themes:

- **The transcript:** user messages, answers as Markdown, the first line of thinking,
  tool calls with a one-line summary of their arguments, and the last 8 lines of tool
  results (red on error). Summaries and new contexts show as rules. `/earlier` loads
  older entries.
- **Live state:** the streaming answer, running tools with the last 6 lines of output,
  retries, compactions, queued input, and why a run failed.
- **The status line:** working or ready, model, thinking level, tokens, `#number`,
  directory.
- **Keys:** Enter sends, and steers while a run is going; Alt+Enter or Ctrl+Shift+Enter
  queues a follow-up; Esc stops the run; Ctrl+C clears the editor, or leaves when it's
  empty, as Ctrl+D does.
- **Commands:** `/new`, `/resume [all | <number>]`, `/earlier`, `/compact`,
  `/thinking`, `/detach`, `/quit`, `/exit`, `/help`.
- **Not done:** reconnecting. When the daemon restarts, the client says so and exits;
  run `pier` again and it continues.

## Candidates

In the order Will chose (below).

### First: robustness

- **Reconnect after a daemon restart.** `AttachedConversation` can already resume a
  transcript (`ConversationTranscript.resume`); the TUI exits instead of retrying.
  This matters once the daemon runs as a service that restarts.
- **Long transcripts.** Every update rebuilds the transcript's component list,
  reusing cached components for finished entries. Unmeasured past a few hundred
  entries.
- **Main screen or alternate screen.** pi-tui has both. The main screen keeps the
  terminal's scrollback, as now; the alternate screen gives pier its own scrolling and
  search (`Ctrl+Shift+F`).

### Second: rendering

- **Edits as diffs.** pi exports `renderDiff(diffText, options)`. Unchecked: whether
  Durable's `edit` tool leaves a diff in its result's `details`, or pier has to compute
  one from the arguments.
- **Tool calls as pi draws them.** pi exports `ToolExecutionComponent(toolName,
  toolCallId, args, options, toolDefinition, ui, cwd)`. Its renderers for pi's own
  tools (`createAllToolRenderers`) are not exported in 1.5.2, and Durable's tools
  aren't pi's tool definitions. Unchecked: how it draws a call with no definition.
  The fallback is pier's own small renderers per tool (bash, read, write, edit).
- **Answers and thinking as pi draws them:** `AssistantMessageComponent(message,
  hideThinkingBlock, markdownTheme, …)` takes a pi-ai message, which is what Durable
  stores. Probably a drop-in; it would also give a show/hide toggle for thinking.
- **Summaries:** `CompactionSummaryMessageComponent`.
- **Images** in tool results and pasted ones. pi-tui renders Kitty and iTerm2 images.
  Unchecked: Alacritty, Will's terminal, has neither protocol, so images may only ever
  be placeholders there.
- **A footer:** cost, context used against the model's window, and the Claude plan's
  5-hour and 7-day windows. pi's `FooterComponent` takes classic pi's `AgentSession`,
  so pier would draw its own. Cost and tokens are in `pi.usage`. Unchecked: whether
  pi-claude-code passes the plan windows on, in its `claude-code.rate-limit`
  diagnostic on each answer.

### Third: pi's habits

Will reviews this list first, and throws out what he doesn't really use.

- **Will's keybindings and theme** from `~/.pi/agent/keybindings.json` and
  `settings.json`; his keybindings remap follow-up to Ctrl+Shift+Enter and Alt+Enter.
  pi-tui exports `KeybindingsManager`. Unchecked: whether pi's app-level manager, with
  pi's action names, is exported for use outside pi.
- **`/model`.** pi's `ModelSelectorComponent` needs a `ModelRuntime`, which lives in the
  daemon. It needs a `models` request in the protocol, and either an adapted picker or
  pier's own list.
- **Thinking level as a picker** (`ThinkingSelectorComponent`) rather than
  `/thinking <level>`.
- **`!command`:** run a shell command in the conversation's directory and environment,
  in the daemon, and show the output. Durable's `bash` tool could run it (as a user
  bash entry), or the daemon could run it directly.
- **`@file` completion.** The client runs in the pane, in the conversation's
  directory, so it can list files itself. pi-tui's `CombinedAutocompleteProvider`
  handles slash commands and paths.
- **Editor:** persistent history across sessions, an external editor (Ctrl+G in pi),
  image paste.
- **A picker for `/resume`.** pi's `SessionSelectorComponent` expects pi's session
  files; pier would feed its own list into a pi-tui `SelectList`.
- **`/fork` and `/tree`.** A Durable fork is a new conversation from an entry
  (`conversation.fork(entryId)`). pi's `TreeSelectorComponent` expects pi's session
  tree. This needs a protocol request and a way to pick the entry.

## Prior art

- pi 1.0.0's Durable demo, `packages/coding-agent/src/experimental/durable/tui.ts` at
  `v1.0.0`: steering, follow-ups, Esc, `/model`, thinking levels and `/compact` on pi's
  components, using the then-internal `createAllToolRenderers` and
  `WorkingStatusIndicator`. It rendered `viewState()`, gone in 1.5, so a port means
  moving it to `watch()` and `ConversationTranscript`.
- p2's TUI (`apps/p2/src/hosts/tui.ts`, and its plugins' `tui.ts` facets): current,
  but built on Chord v2's app kit.

## How to check

- **Offline tests** for anything with logic outside drawing: protocol requests, the
  client's state, completion lists (`test/`, faux model, real socket).
- **By hand, in tmux, with real Claude**, for what a person sees. Drive it with
  `tmux send-keys` and read it with `capture-pane`, as the thin slice's manual checks
  did. A small script under `experiments/` could make that repeatable; not written yet.
- **The gate** only if a change touches how the daemon drives the Harness, as `/model`
  or `!command` might.

## Decided

Will, 2026-11-16: *"Robustness, rendering, then pi's habits (the list of which I'll
review and throw out any of which I don't really use)"*. The candidates above are in
that order.

## Done when

Will uses `pier` for a day's work in some project without missing something from
classic pi badly enough to switch back. Then the rest of this list is deleted or
moved to a later spec, and this file goes.
