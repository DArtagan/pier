# How pier got here

The record of pier's proof of concept, from 2026-10-28 to 2026-11-16: Will's decisions,
what the gate found, and the wrong turns. `docs/vision.md` says what pier is for, and
`docs/principles.md` the rules this history taught; this is the evidence behind them.

The spec it comes from, `todos/poc.md`, was retired on 2026-11-16. Its last version,
with the full record of pi-claude-bridge and its shim, is in git history:
`git show 99064e7:todos/poc.md`.

## Will's decisions

In order, verbatim. Later ones that replace earlier ones say so.

- **Why** (2026-10-28): *"I'd like to move in the direction of using Pi Durable, for
  the purposes of abstracting apart the interface and the harness. Eventually allowing
  me to interface from terminal, web, and mobile. And build more isolation around
  agents' environments. Eventually this could become an orchestration platform as
  well."*
- **The aim of the proof of concept** (2026-10-28): *"For a first proof-of-concept
  version, I'd be looking to get to as-close-as-possible to the vanilla pi
  experience/flows, but built on Durable."* Narrowed on 2026-11-13 to the thin slice.
- **The provider** (2026-10-28): *"I'm okay with dropping or rebuilding all of the
  extensions, except for pi-claude-bridge - that one's indispensable to my set-up."*
  Replaced on 2026-11-13 by pi-claude-code (below).
- **One daemon per host** (2026-10-28). Will asked whether tmux panes could share
  *"one user-wide service that's running the durable pi process and owning the
  storage"*, and on hearing yes, asked for the spec.
- **Its own repo** (2026-10-29), set up like dotfiles (devenv, linters, tests,
  `todos/`, MIT): *"keep the git repo local for now"*. On GitHub as `DArtagan/pier`
  since 2026-11-03, with CI and release-please.
- **On Claude's proposals** (2026-10-29):
  - *"Yes, one SQLite for all conversations"*.
  - *"Yes, for now keep it simple by passing through the whole environment. We can
    refine it later."* `SSH_AUTH_SOCK` included, despite the conflict with dotfiles'
    `todos/ssh-agent.md`.
  - *"Yes, those definitions are fine for quit, exit, detach."* `/quit` stops the run,
    then leaves; `/exit` waits for it; `/detach` leaves it running.
  - On the transport: *"I don't know enough to make a decision here - please describe
    out the option space for me."* Laid out in `todos/wire-format.md`.
- **pier, or Earendil's Pi Roam?** Will asked on 2026-11-13 whether to wait a month
  for p3, and how to build so tools and UIs migrate upstream. Claude's answer: wait,
  or build only a thin local slice. Will: *"Let's build the very thin slice."*
- **pi-claude-code** (2026-11-13): *"seems like there's no downside to using
  Earendil's own pi-claude-code? And it would give us future compatibility."* After it
  passed the gate: *"Yes, switch and drop."*
- **A web UI** as an exception to the thin slice (2026-11-16): recorded in
  `docs/principles.md`, section 1, and `todos/web.md`.
- **The terminal client's order** (2026-11-16): robustness, rendering, then pi's
  habits; done 2026-11-17 ("The terminal client, for daily use", below).
- **Packaging** (2026-11-16): a daemon on thenixbeast and the Steam Deck, started at
  login (dotfiles' `modules/pi/pier.nix`).
- **Daily use isn't a gate** (2026-11-16): *"We can move on without completing the
  'using pier daily', as any findings I have from that will go into future specs."*
  Then the proof of concept's spec was retired, its knowledge moved here and into
  `docs/upstream.md`.

## The gate

`npm run gate` drives real Claude Code turns against a Durable Harness, each step in a
process of its own so it can be killed. It's what proved the stack before any daemon
existed.

- **2026-10-29, pi 1.4.0 and pi-claude-bridge 0.9.3, through a shim** standing in for
  pi's extension API: 33/33, then 40/40 with Esc. A turn with write, read and bash;
  `kill -9` mid-tool, after which the turn finished unprompted with bash
  `interrupted`; compaction; a fork, with root and fork alternating in one process;
  the prompt cache across turns; an AGENTS.md marker on every turn; Esc mid-tool
  leaving no Claude Code behind.
- **2026-11-12, pi 1.5.2 and bridge 0.12.0: 42/42**, after fixing two vacuous checks
  (below).
- **2026-11-13, pi-claude-code at `d5b5e04`: 39/39** (Claude Code 2.1.318, Opus 5.5,
  thinking `low`). The same steps, without the bridge-only ones. Nothing billed to
  Extra Usage. pier switched to it that day.
- **2026-11-23, pi 1.6.0 on Node 26.12.1: 38/38** (Claude Code 2.1.329). The checks in
  `run.ts` are the ones of 2026-11-13; why that run counted 39 wasn't found. Durable
  released the warm Claude Code on `harness.close()` itself, with the gate's own call
  removed: "every host exited by itself" passed. The prompt cache held as before: 95–98%
  on a second turn, 97% after 6 minutes idle.

**The prompt cache**, measured on 2026-11-13 with a 6-minute idle between two turns:

| | Second turn in a row | After 6 minutes idle |
|---|---|---|
| pi-claude-code | 96–98% of input read from cache | 97% |
| pi-claude-bridge 0.12.0 | 99% | 99% |

pi-claude-code writes every entry with a 1-hour lifetime, so a conversation left for up
to an hour costs one cheap cache read on return; one left longer rewrites its context
once. Classic pi's `cacheWarming` keeps a cache warm up to 30 minutes between runs;
Durable has nothing like it. Not measured: an idle over an hour.

## What broke, and what it taught

- **A request's abort signal ends with its task step** (2026-10-29). The bridge tied a
  Claude Code query parked at a tool round to the signal of the request that started
  it, so every turn died at its first tool round. The shim gave it one signal per run.
  Now a rule: nothing that outlives a task phase holds the invocation's signal.
- **Two checks were vacuous** (found 2026-11-12). In 1.5 a tool shows `running` before
  its intent is stored, so the crash step killed the host before the tool had started,
  and the call then rightly ran in full after the restart. "Nothing left running"
  passed because nothing had started. The gate now waits for the process to exist.
  Hence the rule: after writing a test for a fix, disable the fix and watch it fail.
- **Tools escape a process-group kill** (2026-11-12). Durable spawns them detached, so
  killing the host's whole process group left `sleep 20; echo done > slept.txt`
  running, and it wrote its file after the model was told it was interrupted. Only a
  control-group kill reaps them; Claude Code is the same.
- **Claude Code leaks** (2026-11-13). pi-claude-code keeps a warm Claude Code per
  session until pi-ai's `cleanupSessionResources()`, which Durable never calls; one
  kept a gate host alive 40 minutes past its documented limit.
- **Claude Code reports its own directory** (2026-11-13). Run from pier's worktree,
  Claude puzzled over it; from the state directory, it noticed that didn't match the
  conversation's. pier now runs each request in its conversation's directory.
- **Durable's ids aren't for people** (2026-11-13). One counter serves every record,
  so the first test conversation was #2 and the next would have been about #47 (Will
  noticed). pier numbers conversations itself.
- **Under systemd, a stopped tool fails rather than being interrupted** (2026-11-16).
  systemd signals the whole cgroup at once, so a running bash call dies with exit code
  143 while the daemon is still up to store it. The model still learns it was killed,
  and it isn't rerun. `KillMode=mixed` would signal the daemon first; not tried.

**Wrong turn: a process per pane** (2026-10-28). The first plan ran pi in each pane
with one SQLite file per session, as pi 1.0.0's Durable demo did. It works, but puts
the harness back in the interface process, against the whole point. One storage behind
one daemon is Durable's native layout (forks and children just work); its cost is
that a storage error drops every pane until the service restarts. If that ever bites,
the fallback is a Harness per session file in the same process. p2 went further, with
a worker process and store per session.

## The thin slice

Built 2026-11-13: `pier daemon` on a Unix socket, the protocol (JSON in WebSocket
messages, carrying Durable's conversation view and Chord operations), and a terminal
client on pi-tui, with conversations numbered per host and each pane's environment
reaching its conversation's tools. Checked offline over a real socket, and by hand
with real Claude in tmux: tools, detaching and continuing, `/resume`, Esc mid-tool, a
second pane watching live, and SIGTERM mid-tool, after which the turn went on unasked.
What it does is in `README.md`.

**Packaged** 2026-11-16: pier #6 compiled `src/` to `dist/` for packaging, v0.2.0
carried it, and dotfiles #11 runs the daemon as a user service. Checked under
`systemd-run` with the unit's environment before the first switch, then running on
thenixbeast.

## The terminal client, for daily use

Will, 2026-11-16: *"I'm interested in starting to improve the TUI for day-to-day use"*,
in the order *"Robustness, rendering, then pi's habits"*. Robustness and rendering
landed that day (pier #8, #10, #11, then the polish after), each checked offline and by
hand in tmux with real Claude; what the client does now is in `README.md`. pi's habits
followed (#14, below). What it took, and what it found:

- **Reconnecting** (#8). Found on the way: a request on a closed connection never
  settled (ws drops the send without a word); a failed `/resume` detached the pane
  first, freezing it on a view nothing updated; without an `error` listener a socket
  error would have thrown out of the client.
- **Fullscreen by default** (#10), Will: *"Yes, let's do both modes but make fullscreen
  the default - using the same flag that pi uses to switch to the simpler terminal
  mode."* Mouse selection copied through pi's `copyToClipboard`. Links and copying
  needed tmux changes, in dotfiles `1035c03` (Will, the same day: *"Enable hyperlink
  support in alacritty … set-clipboard for the tmux config"*): Shift+click opens a link
  through Alacritty; OSC 52 copies reach Wayland's clipboard only from a pane a client
  is showing, to a focused Alacritty window. Not yet tried over a real SSH session.
- **Long transcripts** (`experiments/transcript/bench.ts`). Will's classic pi sessions
  since October had a median of 79 messages and at most 1,687. Fullscreen frames stayed
  well under a frame's budget: 1.2 ms (p50) at 10,000 entries on pier's own renderers,
  9.4 ms once on pi's components, under 1 ms at 1,700. Regular mode is pi-tui's
  `TuiMainScreen`, which diffs every line each frame: about 5 ms at 1,700 entries, as in
  pi's own regular mode; not raised upstream.
- **Gaps** (#11). The `entries` request dropped Durable's `next` cursor, which
  `ConversationTranscript` reads as "nothing more", so `/earlier` stopped after one page
  and a gap would have closed after one.
- **pi's components** (#11). Tool calls are pi's `ToolExecutionComponent` with the
  renderers of pi's exported tool definitions. Durable has tools of its own (it doesn't
  depend on the coding agent, and its tools are durable tasks run through pi-env), and
  p3's `coding-tools` plugin will follow p2's: Durable's tools drawn by a copy of pi's
  renderers. pier imports them instead (Will: *"Yes please, carry on in that way"*).
  pi's renderers tick a 1 s timer while a call runs, cleared only by a final result, so
  pier settles calls whose slot goes without one, or the client wouldn't exit. Durable's
  bash reports truncation and its spill file as diagnostics, in a `<harness>` block at
  the end of the output, not in the `details` pi's renderer reads.
- **Colors.** pi's default theme makes tool blocks' backgrounds from the terminal's own
  colors, which pi asks for at startup; pier now asks with pi's own theme controller
  (Will: *"The colors absolutely work now"*). A tmux pane no client shows got no
  answer, and falls back to blank panels. The colour test first assumed 24-bit color
  and failed on CI, which has no `COLORTERM`; the tests now pin 24-bit, 256 colors and a
  terminal that never answers.
- **The footer** (#11). pi-claude-code passes Claude Code's `rate_limit_event` on, with
  the plan's 5-hour and 7-day windows (202 of 208 model responses had it, read from the
  live store). Its dollar figure is what the model responses would cost at Anthropic's
  API prices (pi-ai's price list), not a charge: "(sub)", as pi says.
- **Polish** (Will's review, the same day): pi's working line in the editor's border, a
  run line after each run, pi's colors for the footer and the editor's lines, no
  notices on attaching, and a blank line above the editor. The run line has the facts
  of pine-of-glass's cachemire, an extension of Will's classic pi, found by running pi
  in tmux; pier computes them from Durable's stored model responses. cachemire wrote
  `turn: 3 calls`; pier writes `run: 3 turns`, in Durable's terms (Will: *"Let's make
  these all match Durable's terms"*).

pi exports none of its theme instance, theme controller, working indicator, app keymap
or tool renderers in 1.5.2. pier imports the first two from pi's `dist/` by path
(`src/host/theme.ts`, `src/host/colors.ts`) and rebuilds the others from what is
exported; an export from pi would replace each.

### pi's habits (#14)

Will pruned the list on 2026-11-16 and asked for: an autocomplete menu for the editor
that doubles as the picker for commands' arguments (*"Ideally this picker can be pulled
wholly from pi"*), `/model`, `/thinking`, `/resume`, `/fork` and `/tree`, Alt+Up, and
the editor's history across sessions. Each was checked offline and by hand in tmux with
real Claude; what they do is in `README.md`, "Use". What it took, and what it found:

- **The menu is pi-tui's.** pi's `/` menu is `CombinedAutocompleteProvider`, drawn by
  the editor, with a `getArgumentCompletions` per command (async allowed); pi fills it
  in `createBaseAutocompleteProvider`, not exported. pier gives it its own commands
  (`src/host/commands.ts`), and two nudges, reaching one private method: the argument
  menu opens as soon as a picked command and its space are typed, and Enter on an
  argument sends the command, where pi's editor needs a second Enter.
- **Forks.** Durable forks *at* an entry, the last one kept, so pier forks before a
  message by forking at the entry before it. Before the first message there's none, so
  that fork is a new conversation, which Durable doesn't link to anything: `/tree`
  missed it until pier recorded every fork's parent itself (`pier.fork`). Forks of
  one conversation all share its first message, so `/tree` shows each by its first
  message of its own.
- **The prompt cache across branches**, by hand: switching between a conversation and
  its fork, back and forth, every turn read 99.8% of its input from the cache.
- **The client's own lines** ("new conversation #3", errors) were pinned above the
  editor; they now sit in the transcript after the newest message when each appeared,
  and scroll away (Will: *"these kind of messages should become just another block in
  the output stream"*). Queued messages stay pinned until the run takes them in (Will:
  *"that does make sense"*). Alt+Up says nothing (Will: *"Let's get rid of those alert
  messages entirely"*).
- **The history across sessions** clears pi-tui's editor's private `history` array when
  the conversation changes: the editor can only add to it. A pi-tui bump may break it.
- **Images: placeholders only.** Alacritty 0.17, asked outside tmux, answers neither
  Kitty's graphics query nor iTerm2's, and its DA1 reply (`ESC[?6c`) lists no sixel;
  pi-tui also gives every pane under tmux `images: null`. pier draws pi's `[Image: …]`
  placeholder; Claude still sees the image (it read a red PNG and answered "Red").

**Left out, by Will's decision** (2026-11-17), to be raised again only if daily use
asks:

- Reading his keybindings (`keybindings.json`) and the settings `tuiMode`,
  `fullscreenCopyOnSelect` and `fullscreenWheelScrollLines`. His keybindings' one
  change matches pier's keys, and those three settings are at pi's defaults, which
  pier uses.
- `!command`, `@file` completion, an external editor (Ctrl+G) and image paste.
- pi's `/tree`, which moves within one session, with branch summaries and labels:
  Durable branches by forking, so pier's branches are conversations.

Then the spec was closed (Will, 2026-11-17: *"any additional changes I can make as the
need arises. If what is already in this spec is complete, then we can consider it
complete"*).

## Skills

Will, 2026-11-17: *"We need to implement some system for pier to use skills -
specifically `ketch`, to enable online research."* What it does now is in `README.md`,
"Skills". How it got there:

- **A wrong turn: classic pi's discovery.** The first version had pier resolve skills
  as pi does, with pi's package manager over `~/.pi/agent/settings.json`, leaving out
  pi packages' skills, which lean on pi extensions pier doesn't load. It worked: by
  hand with real Claude, asked about Zig's latest release without naming ketch, Claude
  read ketch's `SKILL.md`, ran `ketch search` and `ketch scrape`, and answered with
  cited sources. But it was built without reading p3's plans, against
  `docs/principles.md`, and it tied the layer to classic pi's settings, which p3 won't
  read. It never merged.
- **p3 and p2** (`docs/upstream.md`, "Skills"): one prompt plugin lists every skill;
  other plugins add directories to it.
- **Will's decisions, 2026-11-17:**
  - On one extension or one per tool: *"An extension-per-tool is still of some
    interest to me, as it allows for other component to be packaged in - besides only
    skills. I guess that could be future work and we could keep this one simple with a
    `skill` extension who's only purpose is to load such."* One extension owns the
    list, so per-tool extensions can add to it later, as p2's plugins do.
  - Move gog and Todoist off `~/.pi/agent/skills` too, so pier reads nothing of
    classic pi's for skills.
  - *"The passing of extensions to `pier` should be explicit in the nix configs. Even
    if it's explicitly the same list as `pi`, we want something where if in the future
    I drop pi - `pier`'s configuration remains consistent."*
  - *"Let's go with an environment variable. Keep it simple until we hit the bounds of
    the present implementation."* `PIER_SKILLS`, over a config file, whose one
    advantage was picking up a change without restarting the daemon.
  - A trust check on a project's skills: *"No, let's not ask."* Recorded for the
    isolation work (`docs/upstream.md`).
- **Where packages put skills**: researched, not assumed. pier's first guess,
  `share/<tool>/skills`, was the layout nixpkgs considered and turned down for
  `share/skills/<pname>` (`docs/upstream.md`, "Prior art").
- **dotfiles' `sequential-file-tools.ts`**, which stops classic pi running a `bash`
  call beside the write or edit it was batched with: pier doesn't need it. Its daemon
  sets Durable's `toolExecution: "sequential"`, which runs every round of tool calls
  one at a time, in the model's order. Measured with a faux model: a slow first call
  and a check batched after it missed the first call's file 5 times in 5 with
  `"parallel"`, and never with `"sequential"`. A daemon test now fails without the
  setting.

## Where the proof of concept ended

Its "Done when", as written on 2026-10-28, on the day it was retired:

- Two panes in two projects run two conversations at once through one daemon, each
  with its pane's environment: built and tested offline; not yet tried in daily use.
- A turn with tools, interrupted by a restart, finishes afterwards unasked: done, by
  hand and under systemd.
- The day-to-day flows of vanilla pi: prompt, steer, follow-up, Esc, thinking,
  `/compact`, `/new` and `/resume` are built. `/model`, `/fork`, `/tree`, `!` and
  `@file` moved to the terminal client's spec, which built the first three (above).
- Classic `pi` still works alongside: untouched.
