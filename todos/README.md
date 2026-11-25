# Outstanding work

Transient work specs. Each is self-contained: enough verified context to start a
session cold, plus a prompt to open with.

These are **not** documentation of what's built; that lives in
[`README.md`](../README.md), [`AGENTS.md`](../AGENTS.md) and [`docs/`](../docs/), which
describe pier as it is now. When a piece of work lands, whatever it leaves behind that
is permanently true gets written there, and the spec here is deleted, with its evidence
file. A file sitting in this directory means the work has not been done.

The two age differently. Documentation is corrected whenever pier changes. A spec is a
point-in-time artefact, most useful the day it's written and misleading once acted on,
so it's removed rather than left to rot. Git keeps every deleted spec:
`git log --diff-filter=D -- todos/<name>.md`.

## Open

**[wire-format.md](wire-format.md) — wire format and transport: remote access still open**
The option space for the protocol and for reaching the daemon (Unix socket, SSH,
loopback, tailnet, a tunnel), with Earendil's p2 as prior art. The local part was
settled for the thin slice on 2026-11-13. Its remote-access options feed the sign-in
deep dive in `web.md`, and then it goes.

**[web.md](web.md) — a web UI on Elanor, for this machine, the tailnet and the phone**
Decided by Will on 2026-11-16, as an exception in `docs/principles.md`; deprecated
once p3's web UI covers the same ground. Findings on Elanor, p3 and p2, then a plan
that starts with a deep dive into sign-in.

**[upstream.md](upstream.md) — changes to raise upstream, on hold**
The gaps pier works around (an idle release in Durable, pi's theme exports, a working
directory in pi-claude-code, pi-tui's private members), each with what would replace
its workaround. On hold by Will's decision on 2026-11-24, until pier has settled.

**[remote.md](remote.md) — reaching another host's conversations over SSH**
Decided by Will from 2026-11-17: remote attach, both directions, SSH run by each client
(`pier proxy`), starting conversations on another pier, `pier connect` remembering piers
that name themselves. Waits on `environment.md`: built first, then this is refreshed
from it before any of it is built (Will, 2026-11-24).

**[environment.md](environment.md) — the environment contract: what a conversation's tools run with**
Asked for by Will on 2026-11-24: define an environment's parts as a contract, keep
everything else from tools, then choose each part's source. Decided that day: panes stop
passing their whole environment (reversing 2026-10-29), an allowlist, four groups, base
variables from the login shell, a project's `.env` passing as it is, a daemon-owned
YAML config with a schema, the model told of secrets, `/cd` and the date by a note.
Ready to build: its "Plan" has the steps, in order. The research and measurements are
in `environment.evidence.md`.

**[credentials.md](credentials.md) — credentials: principles first, then a design**
Asked for by Will on 2026-11-24: a system that a project's secrets can move into from
`.env`, for stronger control, with its principles settled before its design. Thirteen
proposed principles, the tiers he chose, and the design questions that follow.

## Writing a spec

Every spec's work happens within `docs/principles.md`; a spec that needs to step
outside it says so, and why, for Will to decide.

What makes these useful when opened cold, months later (after vulcanus-proxmox's
`todos/README.md`, which works the same way):

- **Every line is read as context.** A session opens a spec by reading all of it and
  carries it to the end, so a line that neither helps the next session act nor stops
  it repeating a mistake costs every session after. What belongs: the opening prompt,
  where things stand, the decisions that bind the work, the plan, what was rejected and
  why, the wrong turns it could repeat, and what "done" means.
- **A spec is the present plan, not the conversation that made it.** The questions
  asked, the options weighed and the drafts superseded go in the evidence file; the
  spec keeps the conclusion. When a decision replaces a proposal, the proposal comes
  out of the spec.
- **Evidence goes beside the spec, in `<name>.evidence.md`.** Research, measurements,
  check results, transcripts of a decision's discussion: what a conclusion rests on,
  rather than the conclusion. The spec states the conclusion and names the evidence
  section; a session opens the evidence only to re-examine one. It's not a spec, has no
  opening prompt, and is deleted with its spec.
- **Include the prompt.** The literal text to open a session with, at the top. It says
  whether to build or to put questions to Will first.
- **State what was verified and when.** "Verified 2026-10-21" beats an assertion with
  no provenance. Anything not checked should say so.
- **Note decisions already made, and by whom.** Where Will has expressed a preference,
  record it verbatim, dated, so it is not relitigated.
- **Record why, not just what.** A short "rejected, and why" stops a future session
  re-proposing what was ruled out.
- **Correct in place.** When a finding is overturned, rewrite the passage to say what
  is true rather than appending a correction beneath it, so no reader has to reconcile
  a claim with its refutation. A mistake a later session could plausibly make again
  also goes under the wrong turns.
- **Be honest about wrong turns.** Inheriting bad reasoning is worse than inheriting no
  reasoning.
- **Collapse finished work to what still binds.** When a step lands, its working comes
  out of the spec; what stays is what later steps depend on, and where the result is
  now written down. The commits carry the rest.
- **Point at `docs/` rather than restate it.** Once a step has written its permanent
  facts into `docs/` or `README.md`, the spec names the place. Two copies drift, and
  the spec's is the one that rots.
- **Experiments that a spec's checks run live in `experiments/`**, not in `/tmp`, so a
  later session can run them again. Each says at its top what it checks and how to run
  it.
