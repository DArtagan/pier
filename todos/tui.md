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

- **The transcript, drawn by pi's components:** user messages, answers with their
  thinking (Ctrl+T hides it), tool calls (Ctrl+O expands their output), and compaction
  summaries (Ctrl+O expands them). New contexts show as rules. `/earlier` loads older
  entries. A gap left by a long outage fills itself.
- **Live state:** the streaming answer, running tools with the last 6 lines of output,
  retries, compactions, queued input, and why a run failed.
- **The footer,** under the editor, as pi's, in pi's grey: `#number` and the directory;
  token totals, cost, the context gauge, model and thinking level; and the Claude plan's
  5-hour and 7-day windows, as pi-quotas shows them, green while there's room.
- **pi's working line** in the editor's top border while a run goes (a spinner,
  "Working (escape to interrupt)"), and a **turn line** after each run's answer, as
  pine-of-glass's cachemire draws it in Will's classic pi:
  `◍ turn: 3 calls · 9s · read 5.8k (99.9% cached) · wrote 1.2k · out 0.1k`.
- **Keys:** Enter sends, and steers while a run is going; Alt+Enter or Ctrl+Shift+Enter
  queues a follow-up; Esc stops the run; Ctrl+C clears the editor, or leaves when it's
  empty, as Ctrl+D does.
- **Commands:** `/new`, `/resume [all | <number>]`, `/earlier`, `/compact`,
  `/thinking`, `/detach`, `/quit`, `/exit`, `/help`.
- **Reconnecting** (landed 2026-11-16): when the connection drops, the client retries
  (250 ms, doubling to 2 s) until the daemon is back, then reattaches and resumes the
  transcript with only what it missed. The footer says `reconnecting…`; text sent
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
- **Gaps: done** (2026-11-16). After a long outage, or a client too slow for the view's
  window (100 entries), the transcript holds a gap; the client now fills it at once,
  page by page (`AttachedConversation.fillGaps()`, from the terminal client whenever a
  view with a gap arrives, and again on reconnecting), showing "… loading the messages
  missed" meanwhile. Found on the way, and fixed: the `entries` request dropped
  Durable's `next` cursor, and `ConversationTranscript` takes a page without one to
  mean there's nothing more. So `/earlier` loaded one page and then took it for the
  conversation's start, and a gap would have been closed after one page, losing the
  rest. `entries` now returns `next`; protocol version 3. Tested offline
  (`test/daemon.test.ts`, both failing with the cursor dropped). By hand in tmux the
  same day, with a faux model, not Claude (a gap takes over 100 entries while away): 70
  turns ran on the same storage while the client was away; on reconnecting, all 70
  appeared, once each, in order, and no marker was left.
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

- **Tool calls as pi draws them, edits as diffs: done** (2026-11-16,
  `src/host/tool-calls.ts`). Each call is pi's `ToolExecutionComponent`, with the
  renderers of the tool definitions pi exports (`createBashToolDefinition` and the rest
  for bash, read, write and edit; `createAllToolRenderers` isn't exported in 1.5.2).
  Other tools get pi's fallback: name, arguments as JSON, output. Checked first:
  - Durable's `edit` stores `details.diff` in the format pi's edit renderer reads, so
    an edit shows as pi's diff with nothing computed.
  - Why Durable has tools of its own, and what p3 means to do (asked by Will): Durable
    doesn't depend on pi-coding-agent or pi-agent-core, and its tools are durable
    tasks that run through pi-env, with three result channels, so pi's tool definitions
    don't fit it. p3's `coding-tools` plugin (slice 8, unbriefed) has p2's as
    precedent: Durable's tools, drawn by a copy of pi's renderers
    (`apps/p2/plugins/coding-tools/cards.ts`), edit showing the stored diff. pier
    imports the renderers instead of copying them (Will, 2026-11-16: *"Yes please,
    carry on in that way"*).

  As in pi, one component per call: the stored answer places it, the running slot in
  `pi.live` streams its output (with pi's "Elapsed" clock), and the stored result
  settles it. Calls are never marked `setArgsComplete`, so an edit's renderer doesn't
  read the file to preview a diff the result already has. Ctrl+O expands and
  collapses every call (pi's `app.tools.expand`, added to pi-tui's keymap, since pi's
  app keymap isn't exported; it's what the renderers' "ctrl+o to expand" hints name).

  Found on the way: pi's renderers tick a 1 s `setInterval` while a call runs, cleared
  only by a final result. A call whose slot goes without one (aborted, faulted, another
  conversation) would tick forever and keep the process alive, so `ToolCalls` settles
  those, and all of them on leaving; tests fail without either.

  Not lost, but drawn differently (corrected 2026-11-16; first reported as lost): when
  bash's output passes 2,000 lines or 50 KB, Durable keeps its tail, spills the whole to
  a temporary file, and says so in two diagnostics ("Full output: <path>", "Output
  truncated to its end: N lines, M bytes dropped"). They're stored twice: in the entry's
  `data.diagnostics`, and in the result's content as a `<harness>` block, which the model
  sees too. Nonzero exits work the same way ("Command exited with code 3"). pi's bash
  renderer looks for them in `details`, which Durable's bash doesn't set, so it draws no
  warning line of its own; the `<harness>` block is the output's last lines, so it shows
  in the collapsed view anyway, verbatim. Seen with `seq 1 3000` on the faux model.

  By hand in tmux with real Claude, the same day: `seq 1 40` collapsed to its last 5
  lines with "35 earlier lines, ctrl+o to expand"; read showed its header only, as pi's
  collapsed read does; an edit showed pi's diff; Ctrl+O expanded all three; a 20 s
  loop streamed under its call with "Elapsed 12.0s", and after Esc showed "Took 16.3s"
  and stayed still; leaving returned to the shell at once; reattaching drew the same.
  Benchmark rerun: fullscreen frames at 10,000 entries rose from 1.2 to 4.3 ms p50.
- **Answers, thinking, user messages and summaries as pi draws them: done**
  (2026-11-16). pi's `AssistantMessageComponent`, `UserMessageComponent` and
  `CompactionSummaryMessageComponent`, through `TranscriptStyle` in `src/host/tui.ts`.
  - Thinking shows whole, as pi shows it, rather than its first line. Ctrl+T (pi's
    `app.thinking.toggle`) hides and shows it; the client starts as pi's own
    `hideThinkingBlock` says, read with pi's `SettingsManager` (read only; Will's is
    `false`).
  - The streaming answer is one component, updated as it grows, as in pi.
  - pi's user and answer components mark OSC 133 prompt zones themselves, so pier's
    own `PromptZone` went; answers are now zones too, as in pi.
  - A summary shows collapsed ("Compacted from 44,780 tokens, ctrl+o to expand"), and
    expanded with Ctrl+O, without Durable's `<summary>` wrapping. Durable doesn't record
    the tokens a compaction summarized; pier takes them from the last answer's usage
    before it, as pi does (`calculateContextTokens`), and falls back to a plain rule
    when no answer before it is loaded rather than say "0 tokens".

  By hand in tmux with real Claude, the same day: thinking showed above the answer,
  Ctrl+T turned it to "Thinking..." and back; a poem streamed, thinking first; `/compact`
  after reading three large files showed the collapsed summary, Ctrl+O the whole of it.
  Benchmark rerun: fullscreen frames at 10,000 entries are now 9.4 ms p50 (4.3 before,
  1.2 before pi's tool component); at Will's longest session (about 1,700 entries)
  they're under 1 ms. pi's components cost more per line, as pi's own transcript does.
- **Tool blocks' backgrounds** (asked by Will, 2026-11-16: *"A key component of the
  running tool blocks in pi is that their background is a different color (there are
  different shades with different meanings). Can you replicate that here?"*). pier
  already draws pi's component, which asks the theme for `toolPendingBg`,
  `toolSuccessBg` and `toolErrorBg`. pi's default theme, "system", makes those from the
  terminal's own colors, which pi asks for at startup (OSC 10, 11 and 4); without an
  answer it leaves panels blank. pier now asks as pi does, with pi's own
  `InteractiveThemeController` (`src/host/theme.ts`, imported from pi's `dist/` by
  path, since 1.5.2 doesn't export it), which also applies pi's `theme` setting and
  follows light and dark switches. Offline, with a terminal that answers, a finished
  call gets pi's 24-bit success shade; the test fails without the query.

  **Working, by hand:** Will, 2026-11-16, in his own tmux pane: *"The colors absolutely
  work now."* In a detached tmux 3.8 pane Claude drove the same day, the query got only
  the device attributes reply, as tmux answered none of OSC 10, 11 or 4, so no
  backgrounds showed there. So a pane no client shows may get no colors, and fall back
  to pi's blank panels; why wasn't checked.
- **Polish, from Will's review** (2026-11-16): *"1. Remove the "/help lists the keys
  and commands" message … 2. The "conversation #6 in …" line seems largely redundant to
  the footer, remove it. 3. Follow pi's lead by rendering the footer in a gray. And the
  (still largely available) quotas in a green. 4. Add some space between the editor
  block and the output log. 5. Pi outputs something like how many calls were in the
  last turn and how long the turn took … 6. Use a different color for the lines that
  denote the editor box."* And: *"I like pi's "Working " animation and line while it's
  thinking. Could we replicate that?"* Done the same day:
  - No notices on attaching, but "new conversation #N" for a new one.
  - pier's own text takes pi's theme colors (`src/host/colors.ts`, pi's `theme` read
    from its `dist/` by path, as it isn't exported in 1.5.2): the footer in pi's
    "dim", the plan's room left in "success", amber and red as before.
  - A blank line between the transcript and the editor.
  - The turn line is pine-of-glass's cachemire line (an extension of Will's, not core
    pi, found by running classic pi in tmux), computed from Durable's stored answers:
    each records when it started and how long it took, so a turn runs from the user's
    message to the end of its last answer. It shows only once the whole turn is loaded,
    and not after a failed run.
  - The editor is pi's `CustomEditor`, with pi's working line embedded in its top border
    (`src/host/working.ts`, on pi-tui's `Loader`, as pi's `WorkingStatusIndicator`
    isn't exported), its lines in pi's thinking-level colors (`thinkingHigh` and so on).
    The footer no longer says "working" or "ready"; it says "reconnecting…" when it is.

  By hand in tmux with real Claude, the same day: the working line spun in the editor's
  border through two bash calls and went when the run ended; the turn line read
  `◍ turn: 3 calls · 9s · …` (a 6 s `sleep` among them); the border went from
  `thinkingHigh`'s color to `thinkingLow`'s with `/thinking low`; the plan's values were
  green; reattaching showed no notices.
- **Images** in tool results and pasted ones. pi-tui renders Kitty and iTerm2 images.
  Unchecked: Alacritty, Will's terminal, has neither protocol, so images may only ever
  be placeholders there.
- **A footer: done** (2026-11-16, `src/host/footer.ts`). pi's `FooterComponent` takes
  classic pi's `AgentSession`, so pier draws its own, laid out as pi's and placed as
  pi's `createChatViewport` places it, under the editor:
  - `#3 · ~/repositories/pier`: the conversation and the directory (it replaced pier's
    status line; "ready" and "working" went with the polish below).
  - `↑12 ↓3.4k R250k W9.0k $0.140 (sub) 25.5%/200k`, then the model and thinking level
    on the right: pi's token totals (from `pi.usage`, every model the conversation
    used), its cost with pi's "(sub)" for a subscription, and its context gauge, amber
    past 70% and red past 90%. The context is the last answer's, as pi's; "?" after a
    compaction until the next answer, as pi's. The model's window comes from a new
    `model` request (protocol 4): the daemon's catalog knows it, the client doesn't.
  - `5h:86% left (↺in 2h 5m) 7d:92% left (↺in 6d 6h 5m)`: the plan, worded as pi-quotas
    words it in Will's classic pi, amber from 80% used and red from 90%, and "on usage
    credits" in red if a turn was charged to them.

  Checked first: pi-claude-code does pass the plan's windows on. Its
  `claude-code.rate-limit` diagnostic carries Claude Code's `rate_limit_event`, with
  `unifiedWindows.five_hour` and `.seven_day` (`utilization` 0 to 1, `resetsAt` in
  seconds). Read from the live store, read only, 2026-11-16: 202 of 208 recent answers
  had it. Missing, by design: pi-quotas' per-model 7-day windows and its pace warnings,
  which come from Anthropic's API rather than Claude Code.

  By hand in tmux with real Claude, the same day: the footer read `$0.000 (sub)
  ?/1.0M` before the first answer (the daemon reported 1M for Opus 5.5), then
  `↑2 ↓14 R1.2k W995 $0.008 (sub) 0.2%/1.0M … claude-opus-5-5 • high` and
  `5h:85% left (↺in 3h 21m) 7d:92% left (↺in 6d 7h 21m)`; at 50 columns in regular mode
  each line was cut to fit.

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
