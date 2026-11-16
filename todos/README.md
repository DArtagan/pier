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

**[tui.md](tui.md) — the terminal client, for daily use**
What's there, and candidates for making it good for daily use: diffs, pi's own
components, a footer, `/model`, `!command`, `@file`, keybindings, reconnecting. Each
has its facts checked or marked unchecked. Will's order (2026-11-16): robustness,
rendering, then pi's habits, which he'll prune first.

**[web.md](web.md) — a web UI on Elanor, for this machine, the tailnet and the phone**
Decided by Will on 2026-11-16, as an exception in `docs/principles.md`; deprecated
once p3's web UI covers the same ground. Findings on Elanor, p3 and p2, then a plan
that starts with a deep dive into sign-in.

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
