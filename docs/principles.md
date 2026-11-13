# pier's principles

Every piece of work on pier happens within these. They're the principles it has been
built under and the ones it learned along the way, mostly between 2026-10-28 and
2026-11-13. A change that would break one needs Will's decision first, recorded here
when he makes it.

Facts about Durable and pi-claude-code that these rest on are in `CLAUDE.md`; the
history behind them is in `todos/poc.md`.

## 1. pier is a thin bridge, not a product

- **Why pier exists:** to use pi on Pi Durable now, from tmux panes on one host, while
  Earendil builds the real thing. Will's aim (2026-10-28) is to separate the interface
  from the harness, reach it from terminal, web and phone, isolate agents'
  environments, and perhaps orchestrate them. Earendil's p3, "Pi Roam", is designing
  exactly that.
- **Build the very thin slice** (Will, 2026-11-13). Build only what daily use asks
  for. Don't build what p3 is centred on: sign-in, remote access, a web UI, a plugin
  system, several users.
- **Ask of every addition:** is it needed for daily use now? And will it carry over
  to p3, or be cheap to throw away? If neither, it waits.
- **Prefer less pier.** When an upstream piece does the job, use it and delete pier's
  own:
  - pi-claude-code replaced pier's bridge shim.
  - Durable's `ConversationTranscript` keeps the client's transcript.
  - pi-tui and pi's themes draw the terminal client.

## 2. Build so it carries over to p3

- **Agent behaviour goes in Durable extensions** (prompt sections, tools, hooks), and
  pier's state in **Durable documents**, never in daemon code. p3 plans to take
  plugins' Durable extensions as they are.
- **Providers are plain pi-ai providers.** Nothing leans on pi's old extension API,
  which p3 calls "a catalogue of what users wanted, not a model".
- **Clients render Durable's own view:** state, not events. The protocol is an
  envelope around it, and the transport a thin adapter under it.
- **Expect to throw away** the daemon, the socket, the envelope, the CLI and the SQLite
  file. Treat conversations as disposable; moving them to p3 would take a conversion.

## 3. Upstream first, and current

- **Earendil's choices are the default.** Work around one only when daily use needs
  it, and then:
  - keep the workaround in one place;
  - say in its comment that it's a workaround, and what upstream change would replace
    it (as `src/providers/claude-code.ts` does for Claude Code's directory);
  - offer to raise the gap upstream. Raising it is outward-facing, so ask Will first.
- **No patched or forked dependencies** where a contained workaround will do. A
  patched npm package complicates packaging, and a fork is one more thing to keep up.
- **Pin exactly, bump deliberately.** Every `@earendil-works/*` package is pinned to
  one release, and pi-claude-code to one commit. Durable is experimental, and breaking
  changes land in minor releases. To bump:
  1. Read the changelogs of durable, chord, ai, coding-agent and tui, and pi-claude-code's
     commits.
  2. Re-check what pier's docs and specs claim against them.
  3. Run the tests and the gate.
- **pier's versions are its own.** It builds from its own lockfile, not from the pi
  nixpkgs ships.
- **Watch Earendil's direction.** Before building a new piece, read what's new in
  `apps/p3/docs/` on pi's `main` (status, plan, decisions). Record what changes
  pier's course in `todos/poc.md`.
- **Read the source, from a tagged clone.** npm ships `dist/` only. Verify against code
  and changelogs; don't assume from names or old docs.

## 4. Local, minimal, and Will's own

- **Local first.**
  - Data lives in one SQLite file on the host, which Will backs up.
  - Other hosts are reached over SSH, and later the tailnet.
  - No hosted service sits in the path: not Radius, which Pi Roam leans on for remote
    access, backups and sign-in.
  - Claude comes through Claude Code, on Will's subscription.
- **One daemon per host, one storage.**
  - It listens on a Unix socket, guarded by file permissions, and nothing on a network.
  - Its socket and state directories are private.
  - Each conversation's tools run with the environment of the pane that last attached
    (Will, 2026-10-29: pass the whole environment, refine later).
- **Use what the environment already has** instead of building equivalents: Nix and
  devenv, systemd (for supervision and the cgroup kill), tmux, SSH.
- **Few dependencies, all pinned, all fetchable without git or SSH:** tarballs, not
  git URLs, so CI and Nix can build without keys.
- **Classic pi stays installed and working** alongside pier, until pier replaces it
  by Will's decision.

## 5. Evidence, not assumption

- **Claims are backed by running things, and say when.** "Verified 2026-11-13" beats an
  assertion. What wasn't tested is reported as such.
- **Choose the check by what changed:**

  | When this changes | Check with |
  |---|---|
  | The provider, pi's version, or how pier drives the Harness | The gate, against real Claude. It costs about twenty Opus turns, so not routinely. |
  | Anything else | Offline tests with a faux model, over a real socket and real SQLite |
  | What a person sees | A run by hand with real Claude, in tmux |

- **A check that can't fail checks nothing.** After writing a test for a fix, disable
  the fix and watch the test fail. Two of this project's checks were vacuous before
  that was done:
  - The crash test killed the host before the tool had started.
  - "Nothing left running" passed only because nothing had started.
- **Measure before worrying, and before reassuring.** The prompt-cache concern was
  settled by measuring an idle conversation, not by reasoning about it.

## 6. Hard-won constraints

Each cost a failure to learn. Detail is in `CLAUDE.md`; new work must respect them.

- **Signals:** an invocation's abort signal fires when the invocation ends, normally
  too. Nothing that outlives a task phase may hold it.
- **Shown is not stored:** Durable shows streamed output and a tool's `running` status
  before storing them. A crash can rerun a call that looked as if it had started.
- **Process groups:** tools and Claude Code run detached, in process groups of their
  own. Only a control-group kill reaps them, so the service must keep
  `KillMode=control-group`.
- **Provider resources:** Durable never releases them; the host calls
  `cleanupSessionResources()`.
- **IDs:** Durable's ids share one counter across all records. Never show them to
  people; pier numbers conversations itself.
- **Directories:** Claude Code reports its own working directory to the model, so each
  request runs in its conversation's directory.

## 7. How work is done

- **Will decides direction.**
  - Record his decisions verbatim and dated, in the spec they affect.
  - Mark Claude's proposals as proposals until he agrees.
  - Don't relitigate a decision unless new facts change it. Then present the facts and
    let him decide again, as with the bridge (indispensable on 2026-10-28, replaced on
    2026-11-13).
- **Outward-facing actions need his OK each time:** pushing, pull requests,
  releases, upstream issues, anything published. An OK for one push isn't one for the
  next.
- **Specs in `todos/`** carry verified context and an opening prompt, and are deleted
  when their work lands. What stays true moves to `README.md`, `CLAUDE.md` or `docs/`.
- **Commits are Conventional Commits**, each passing the hooks on its own.
  - When a hook rewrites files, stage them and make a fresh commit; never amend
    blindly.
  - Check what a commit holds afterwards.
- **Report faithfully.** Say what failed, what was skipped, and what was guessed,
  plainly, alongside what worked.
