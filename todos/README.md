# Outstanding work

Transient work specs. Each is self-contained: enough verified context to start a
session cold, plus a prompt to open with.

These are **not** documentation of what's built; that lives in
[`README.md`](../README.md) and [`CLAUDE.md`](../CLAUDE.md). When a piece of work
lands, whatever it leaves behind that is permanently true gets written there, and the
spec here is deleted. A file sitting in this directory means the work has not been done.

## Open

**[poc.md](poc.md) — the proof of concept: daemon, protocol, TUI client, vanilla parity**
Step 1, the gate, passed on 2026-10-29 with pi-claude-bridge, and on pi 1.5.2 with
Earendil's pi-claude-code on 2026-11-13 (39/39), which replaced the bridge that day.
Next is a very thin slice (Will, 2026-11-13): a daemon, a Unix socket and a minimal
terminal client, while Earendil's Pi Roam takes shape. Packaging and the home-manager
module (step 5) are tracked in dotfiles' `todos/pi-durable.md`.

**[wire-format.md](wire-format.md) — wire format and transport: options to decide**
An interim decision report for Will, revised for pi 1.5.2 on 2026-11-12. Compares the
protocol options for step 2 (Durable's view plus commands, Chord v2's app kit, pi's
RPC, ACP, bespoke; Durable's agent events were removed in 1.5), framing, and how
clients reach the daemon (Unix socket, SSH, loopback, tailnet, a tunnel), with
Earendil's own p2 as prior art, recommendations and five questions. Waiting on
Will's answers.

## Writing a spec

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
