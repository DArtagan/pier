# pier

pi on [Pi Durable](https://earendil.com/posts/pi-durable): one daemon per host owns
every pi session, and terminals (later web and phone) attach to it as thin clients.
Like a pier: it stays put, and boats tie up and cast off.

**Status:** proof of concept, step 1 of 5 done. The bridge gate passed on 2026-10-29,
and again on pi 1.5.2 with pi-claude-bridge 0.12.0 on 2026-11-12: pi-claude-bridge runs
on a Durable Harness through a shim, including a crash mid-tool, Esc mid-tool,
compaction and forks. The daemon, protocol and TUI client are next; see
[`todos/`](todos/).

## Layout

- `src/bridge/load.ts` loads pi-claude-bridge, which ships TypeScript, with jiti as pi does.
- `src/bridge/shim.ts` runs the bridge on a Harness by standing in for the parts of pi's
  extension API it uses (below).
- `src/prompt.ts` builds the system prompt from AGENTS.md files and skills, found the way
  pi finds them.
- `experiments/bridge-gate/` holds the bridge gate: real Claude Code turns against a
  Durable Harness, each step in its own process so it can be killed.
- `test/` holds offline tests of the shim against a stand-in bridge.
- `todos/` holds specs for work not yet done.
- `docs/releasing.md` says how release-please makes versions.

## Commands

```bash
direnv allow          # once; or `devenv shell`. Installs node_modules and the git hooks.
npm test              # offline unit tests (also a pre-commit hook)
npm run check         # typecheck (also a pre-commit hook)
devenv test           # both
npm run gate          # the bridge gate: about twenty Opus turns on your Claude Code login
```

The gate prints a PASS/FAIL line per check and leaves its state directory in `/tmp`: the
SQLite storage, the bridge's debug log (`bridge.log`), every event (`transcript.jsonl`),
and an agent dir of its own (`agent/`), where the bridge keeps its session state.

## How the bridge runs on Durable

pi-claude-bridge is a pi extension: a factory that takes pi's `ExtensionAPI`. The shim
calls it with a stand-in and turns what the bridge needs into Durable terms:

| The bridge | The shim |
|---|---|
| `registerProvider("claude-bridge", config)` | Registers it with pi's `ModelRuntime`, which is the Harness's `models`, with `streamSimple` wrapped (signals, below). |
| `registerTool` | Drops any tool. Since 0.11.0 the bridge registers none: AskClaude moved to its own package. |
| `session_start` | Fired once per conversation per process, on its first request or compaction, with reason `startup`. The session id is the conversation's provider session id (`pi.provider`), and `cwd` is the conversation's. |
| `before_agent_start` | Fired from a `beforeRequest` hook on every request. The prompt is keyed with the bridge's own `toBridgeContext`, over the same messages, so the lookup matches. |
| `session_compact` | Fired when a request's history doesn't extend the previous one: after a compaction or a reset. |
| `tool_call` | Never fired: Durable has no such event. The bridge uses it to give bash calls a 120 s default timeout, so pier's bash has none. |
| `session_shutdown` | Fired by `shim.shutdown()`, before the Harness closes. |

Three things that aren't obvious, all checked by the gate or the unit tests:

- **Signals.** The bridge keeps a Claude Code query alive across a tool round, tied to
  the signal of the request that started it. pi's signal lasts a run. Durable's lasts a
  task invocation, and aborts when the invocation ends, normally too, which killed every
  query at its first tool round. The shim gives the bridge one signal per session and
  run. It passes an abort through only while a request is still streaming, and aborts
  the signal itself when the run ends. That covers Esc during a tool round, when nothing
  is streaming. It sees runs end by observing the Harness's stored commits, so a host
  calls `shim.attach(harness)` right after opening it. (Bridge 0.12 copes with
  per-request signals for later requests itself, but not for the first.)
- **No `new`, `resume` or `fork` reasons.** With bridge 0.9.3, those cleared *every*
  session's state, which in one process serving many conversations means all of them.
  Since 0.11 they don't, and `fork` could let a fork start from its parent's Claude
  Code session; the shim doesn't do that yet (see `todos/poc.md`).
- **The rewrite mark** (`session_compact`) was essential with bridge 0.9.3: without
  it, the turn after a compaction started Claude Code with no history at all. Bridge
  0.12 compares message content and notices the rewrite by itself (the gate's control
  run), so the mark is now a safety net.

Not needed: `session_before_compact`, because Durable sends summaries with the
conversation's session id, which the bridge falls back to. `session_tree` isn't needed
either, because a Durable fork is a new conversation with a fresh session id.

## Versions

pi's packages are pinned exactly in `package.json`, all to one release (1.5.2). Pi
Durable is experimental, and breaking changes land in minor releases, so bump them
together and deliberately: read their changelogs, then run the tests and the gate.

pier doesn't follow the pi that nixpkgs ships (1.5.0 on 2026-11-12). Its packages come
from its own lockfile, so nothing ties the two together, and pi-claude-bridge 0.12.0
needs pi 1.5.1 or newer. What pier shares with classic pi is `~/.pi/agent`: settings,
credentials, `claude-bridge.json`, and the bridge's per-session state, which is keyed
by session id, so the two never touch each other's.

pi-claude-bridge comes from npm (0.12.0). dotfiles' `pkgs/pi-claude-bridge` is 0.11.0,
for nixpkgs' pi, plus `multi-session-registration.patch`, which only matters when
several copies of the bridge are loaded in one process.

## License

MIT
