# The terminal client, for daily use

## Opening prompt

> Read `docs/vision.md`, `docs/principles.md`, then `todos/tui.md`. Robustness and
> rendering are done (`docs/history.md`, "The terminal client, for daily use"). Will
> reviews "pi's habits" below first, and prunes it; then work through what's left. For
> each: check the facts marked "unchecked" first, keep it in `src/host/`, prefer pi's
> exported components over pier's own, test what can be tested offline, and try it by
> hand in tmux with real Claude. Update this spec as items land, and delete it when
> it's done.

Written 2026-11-16. Will's words that day: *"I'm interested in starting to improve the
TUI for day-to-day use"*, and *"Yes, start a todos/tui.md"*. Trimmed the same day, once
robustness and rendering landed: what they built is in `README.md`, and how, with what
was found and measured, in `docs/history.md`.

## Where this sits

- The terminal client is **host code** (`src/host/`): it's thrown away when p3 takes
  over, and p3 builds its own (slice 27, a scaffold; slice 16, the full client). So
  build what daily use asks for, cheaply, and nothing to make it last
  (`docs/vision.md`).
- **Use pi's own pieces where they fit.** pi exports its interactive components "for
  extensions", which saves writing them and makes pier look and feel like pi. Several
  expect classic pi's types (`AgentSession`, pi's session files, pi's tool
  definitions), so check each one's constructor before planning around it. What 1.5.2
  doesn't export, and how pier gets round it, is in `docs/upstream.md`, "pi's own
  pieces".
- It stays in pier, beside the daemon: clients render Durable's own view, so they
  must ship with the daemon they talk to.

## Left of rendering

- **Images** in tool results and pasted ones. pi-tui renders Kitty and iTerm2 images.
  Unchecked: Alacritty, Will's terminal, has neither protocol, so images may only ever
  be placeholders there.

## pi's habits

Will reviews this list first, and throws out what he doesn't really use.

- **Will's keybindings and settings** from `~/.pi/agent/keybindings.json` and
  `settings.json`. His keybindings remap follow-up to Ctrl+Shift+Enter and Alt+Enter,
  which pier happens to use already. pier reads `theme` and `hideThinkingBlock`, not
  `tuiMode`, `fullscreenCopyOnSelect` or `fullscreenWheelScrollLines`. pi's app-level
  `KeybindingsManager`, with pi's action names, isn't exported in 1.5.2; pier adds the
  three it needs to pi-tui's (`installKeybindings` in `src/host/tool-calls.ts`).
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
  components. It rendered `viewState()`, gone in 1.5, so a port means moving it to
  `watch()` and `ConversationTranscript`.
- p2's TUI (`apps/p2/src/hosts/tui.ts`, and its plugins' `tui.ts` facets): current,
  but built on Chord v2's app kit.

## How to check

- **Offline tests** for anything with logic outside drawing: protocol requests, the
  client's state, completion lists (`test/`, faux model, real socket). Pin what depends
  on the terminal (`setCapabilityOverrides`): CI has no `COLORTERM`.
- **By hand, in tmux, with real Claude**, for what a person sees: a daemon of its own
  (`PIER_SOCKET`, `PIER_STATE_DIR` under `/tmp`), driven with `tmux send-keys` and read
  with `capture-pane` (`-e` for colors). A pane no client shows gets no answer to pi's
  color query. Never attach a script to Will's own daemon: attaching replaces a
  conversation's tools' environment.
- **The gate** only if a change touches how the daemon drives the Harness, as `/model`
  or `!command` might.

## Decided

Will, 2026-11-16: *"Robustness, rendering, then pi's habits (the list of which I'll
review and throw out any of which I don't really use)"*.

## Done when

Will uses `pier` for a day's work in some project without missing something from
classic pi badly enough to switch back. Then the rest of this list is deleted or
moved to a later spec, and this file goes.
