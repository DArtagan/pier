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

`src/host/tui.ts`, about 500 lines on pi-tui's renderers, with pi's Markdown and list
themes:

- **Two modes, as pi has** (landed 2026-11-16). Fullscreen by default: pi-tui's
  `TuiAltScreen`, set up and laid out as pi's own `createInteractiveTui` and
  `createChatViewport` do (neither is exported in 1.5.2, so pier copies about 50 lines).
  It scrolls, searches, selects and copies (pi's `copyToClipboard`), and on leaving
  prints the transcript into the scrollback, as pi's default
  `fullscreenExitOutput: "transcript"` does. `--tui-mode regular`, pi's flag, keeps
  `TuiMainScreen`. User messages carry pi's OSC 133 prompt markers, which fullscreen's
  Ctrl+Up and Ctrl+Down jump between.

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
- **Reconnecting** (landed 2026-11-16): when the connection drops, the client retries
  (250 ms, doubling to 2 s) until the daemon is back, then reattaches and resumes the
  transcript with only what it missed. The status line says `reconnecting…`; text sent
  meanwhile stays in the editor; Ctrl+C leaves. It gives up only when the daemon
  refuses (another protocol version, or the conversation is gone).

## Candidates

In the order Will chose (below).

### First: robustness

- **Reconnect after a daemon restart: done** (2026-11-16). `connectWhenUp()` and
  `AttachedConversation.reattach()` in `src/host/client.ts`, tested offline across a
  restart. By hand in tmux with real Claude, the same day: the daemon stopped while
  idle for 25 s, stopped mid-run during a bash `sleep 20` (Durable resumed the run, bash
  came back interrupted, and Claude's answer reached the same pane), and SIGKILLed,
  leaving a stale socket. Found on the way, and fixed:
  - `PierClient.request` on a closed connection never settled: ws drops the send
    without a word.
  - A failed attach (`/resume 99`) detached the connection first, freezing the pane on
    a view nothing updated any more; the daemon now opens the target first.
  - With no `error` listener after connecting, a socket error would have thrown out of
    the client.
- **Gaps.** After a long outage, or a client too slow for the view's window, the
  transcript holds a gap ("… some messages aren't loaded"), and nothing fills it:
  `ConversationTranscript.fillGap()` would, from a command or on reconnecting. Not
  seen in the runs by hand, whose outages missed fewer entries than the window holds.
- **Long transcripts: measured, fine fullscreen** (2026-11-16,
  `node --expose-gc experiments/transcript/bench.ts`). Each update from the daemon
  refills the transcript (`fillTranscript`, reusing stored entries' components, which
  `test/tui.test.ts` checks), and each frame lays out the whole transcript, as pi's
  does. With an answer streaming at 120×50, six entries a turn (two of them 20-line tool
  results):

  | Entries | Lines | Fill, p50 | Frame fullscreen, p50 / p95 | Frame regular, p50 / p95 | Heap fullscreen |
  |---|---|---|---|---|---|
  | 100 | 1,080 | <0.01 ms | 0.14 / 0.17 ms | 0.39 / 0.49 ms | 5 MiB |
  | 1,000 | 10,800 | 0.02 ms | 0.20 / 0.32 ms | 3.1 / 4.3 ms | 8 MiB |
  | 3,000 | 32,400 | 0.04 ms | 0.38 / 0.54 ms | 10.9 / 14.9 ms | 19 MiB |
  | 10,000 | 108,000 | 0.18 ms | 1.2 / 3.6 ms | 41.7 / 45.3 ms | 59 MiB |

  How long they get: Will's classic pi sessions since October (121) have a median of 79
  messages, a 90th percentile of 410, a 99th of 1,079, and at most 1,687 (counted
  2026-11-16); a message is about one entry. A pier client holds only what it loaded:
  the newest 50 on attaching, then what streams in and what `/earlier` brings, 50 at a
  time, so the first frame of thousands of new entries at once (430 ms at 10,000) doesn't
  happen in use. Fullscreen needs nothing. Regular mode is pi-tui's `TuiMainScreen`,
  which diffs every line each frame: about 5 ms a frame at Will's longest session, up to
  60 frames a second while an answer streams. It's the renderer pi's regular mode uses,
  so a fix belongs upstream; not raised.
- **Main screen or alternate screen: both, fullscreen by default** (2026-11-16). By
  hand in tmux with real Claude, the same day: a 60-line answer scrolled with PageUp,
  Ctrl+Home and Ctrl+End, with the scrollbar and the "Jump to latest message · Ctrl+End"
  label; Ctrl+Shift+F found its one match; Ctrl+Up jumped to a prompt, and didn't with
  the OSC 133 markers taken out; Esc stopped a run; the client reconnected across a
  daemon restart; leaving left all 60 lines in tmux's scrollback; `--tui-mode regular`
  ran on the main screen, and `--tui-mode alt` was refused.

  **Mouse selection**, the same day, with SGR mouse events sent into the pane as tmux
  passes Alacritty's on (`tmux send-keys -l $'\e[<0;6;6M'` …): a drag copied
  `quick brown`, a double-click `fox`, and a triple-click the whole line (with pier's
  one-column margin, as pi's would). Copies go through pi's `copyToClipboard`, which on
  this desktop runs `wl-copy`; read back with `wl-paste`. Not tried with a real mouse,
  which tmux (`mouse on`) passes on the same way.

  **Links open with Shift+click, through Alacritty; pier passes no `openUrl`.** Will
  decided (2026-11-16) to make tmux pass hyperlinks on rather than give pier an opener
  of its own (pi's `openBrowser` isn't exported): *"Yes, let's do both to my ~/dotfiles:
  1. Enable hyperlink support in alacritty 2. set-clipboard for the tmux config"*.
  Dotfiles `1035c03` adds `terminal-features ",alacritty*:RGB:hyperlinks"`; Alacritty
  needed nothing, as it takes OSC 8 already and its default URL hint opens them. pi-tui
  emits OSC 8 when tmux's `client_termfeatures` lists `hyperlinks`, which it does for
  clients attached since; it then shows a link's text alone, not `text (url)`.
  Shift+click opened one in pi (Will, 2026-11-16). Without Shift, a click opens a link
  in pi's fullscreen, through `openBrowser`, and does nothing in pier's.

  **Copying over SSH: fixed in dotfiles, with two conditions.** In a session over SSH,
  `copyToClipboard` sends OSC 52 for the client's terminal. Will's tmux ignored those
  (`set-clipboard` was tmux's default, `external`); dotfiles `1035c03` sets it `on`.
  Checked 2026-11-16, with tmux's server log: tmux keeps the copy as a buffer and
  writes it on to the client, and an OSC 52 printed in a pane reached Wayland's
  clipboard. The conditions, both seen that day:
  - tmux forwards only to clients showing the pane's window
    (`screen_write_set_client_cb`), so a copy from a background window stays a tmux
    buffer.
  - Alacritty on Wayland sets the clipboard only while one of its windows has keyboard
    focus; the same sequence to an unfocused window did nothing.
  It sets the clipboard, not the primary selection, so it pastes with Ctrl+Shift+V,
  not middle-click or Shift+Insert. Checked on this machine only: not yet from pi or
  pier over a real SSH session.

  Not done: Will's own `tuiMode`, `fullscreenCopyOnSelect` and
  `fullscreenWheelScrollLines` from `settings.json` aren't read; pier takes the flag
  only, with pi's defaults. That belongs with his settings, under pi's habits.

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

Will, 2026-11-16, of the main and alternate screens: *"Yes, let's do both modes but make
fullscreen the default - using the same flag that pi uses to switch to the simpler
terminal mode."* His pi's `settings.json` has `"tuiMode": "fullscreen"`.

## Done when

Will uses `pier` for a day's work in some project without missing something from
classic pi badly enough to switch back. Then the rest of this list is deleted or
moved to a later spec, and this file goes.
