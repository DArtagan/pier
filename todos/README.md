# Outstanding work

Transient work specs. Each is self-contained: enough verified context to start a
session cold, plus a prompt to open with.

These are **not** documentation of what's built; that lives in
[`README.md`](../README.md) and [`CLAUDE.md`](../CLAUDE.md). When a piece of work
lands, whatever it leaves behind that is permanently true gets written there, and the
spec here is deleted. A file sitting in this directory means the work has not been done.

## Open

**[poc.md](poc.md) — the proof of concept: a thin slice, then what daily use asks for**
The gate passed on 2026-10-29 with pi-claude-bridge, and on pi 1.5.2 with Earendil's
pi-claude-code on 2026-11-13 (39/39), which replaced the bridge that day. The thin
slice Will chose that day is built: `pier daemon`, a Unix socket, and a minimal
terminal client, checked offline and by hand with real Claude. Next: daily use, and
packaging in dotfiles' `todos/pi-durable.md`. The rest waits on Earendil's Pi Roam.

**[wire-format.md](wire-format.md) — wire format and transport: remote access still open**
The option space for the protocol and for reaching the daemon (Unix socket, SSH,
loopback, tailnet, a tunnel), with Earendil's p2 as prior art. The local part was
settled for the thin slice on 2026-11-13; it stays as the reference for a web or
phone client.

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
