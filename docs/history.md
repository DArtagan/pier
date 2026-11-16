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
  habits; `todos/tui.md`.
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

## Where the proof of concept ended

Its "Done when", as written on 2026-10-28, on the day it was retired:

- Two panes in two projects run two conversations at once through one daemon, each
  with its pane's environment: built and tested offline; not yet tried in daily use.
- A turn with tools, interrupted by a restart, finishes afterwards unasked: done, by
  hand and under systemd.
- The day-to-day flows of vanilla pi: prompt, steer, follow-up, Esc, thinking,
  `/compact`, `/new` and `/resume` are built. `/model`, `/fork`, `/tree`, `!` and
  `@file` moved to `todos/tui.md`.
- Classic `pi` still works alongside: untouched.
