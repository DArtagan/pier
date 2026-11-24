# Outstanding work

Transient work specs. Each is self-contained: enough verified context to start a
session cold, plus a prompt to open with.

These are **not** documentation of what's built; that lives in
[`README.md`](../README.md) and [`AGENTS.md`](../AGENTS.md). When a piece of work
lands, whatever it leaves behind that is permanently true gets written there, and the
spec here is deleted. A file sitting in this directory means the work has not been done.

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
that name themselves. Waits on `environment.md`; the directory is still open.

**[environment.md](environment.md) — the environment contract: what a conversation's tools run with**
Asked for by Will on 2026-11-24: define an environment's parts as a contract, keep
everything else from tools, then choose each part's source. Reopens passing a pane's
whole environment (2026-10-29), for local panes too. Proposals and open questions.

## Writing a spec

Every spec's work happens within `docs/principles.md`; a spec that needs to step
outside it says so, and why, for Will to decide.

What makes these useful when opened cold, months later:

- **State what was verified and when.** "Verified 2026-10-21" beats an assertion
  with no provenance. Anything not checked should say so.
- **Record why, not just what.** A future session that knows why an approach was
  rejected will not re-propose it.
- **Include the prompt.** Ending with the literal text to open a session with
  removes the work of reconstructing intent.
- **Note decisions already made, and by whom.** Where the user has expressed a
  preference, record it verbatim so it is not relitigated.
- **Be honest about wrong turns.** Inheriting bad reasoning is worse than
  inheriting no reasoning.
