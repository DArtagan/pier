# pier

pi on [Pi Durable](https://earendil.com/posts/pi-durable): one daemon per host owns
every pi session, and terminals (later web and phone) attach to it as thin clients.
Like a pier: it stays put, and boats tie up and cast off.

**Status:** proof of concept, as a deliberately thin slice: a daemon, a Unix socket,
and a minimal terminal client. Claude runs on a Durable Harness through Claude Code,
with your Claude subscription, and survives a crash mid-tool, Esc, compaction and
forks (pi 1.5.2, 2026-11-13). See [`todos/`](todos/) for what's next.

## Use

```bash
pier daemon           # the daemon, in the foreground (packaged as a user service later)
pier                  # in a project: continue its newest conversation, or start one
pier new              # start a new one
pier resume <n>       # attach to conversation #<n>
pier list [--all]     # conversations here (or everywhere)
```

Until it's packaged, `npm run pier -- <args>`, or `node src/cli.ts`. In the client,
`/help` lists the keys and commands. Enter sends, and steers while Claude works;
Alt+Enter queues a follow-up; Esc stops the run; Ctrl+C on an empty editor leaves, and
the run carries on. Conversations are numbered #1, #2, … on each host. Any number of panes can attach to
one conversation. Each
conversation's tools run in its directory, with the environment of the last pane that
attached to it.

The socket is `$XDG_RUNTIME_DIR/pier/pier.sock` and the storage
`$XDG_STATE_HOME/pier/pier.sqlite`; `PIER_SOCKET`, `PIER_STATE_DIR`, `PIER_MODEL`
(`claude-code/claude-opus-5-5`) and `PIER_THINKING` (`high`) override them.

## Layout

- `src/daemon.ts` runs the Harness and serves it on the socket; `src/protocol.ts` is what
  goes over it; `src/client.ts` and `src/tui.ts` are the client; `src/cli.ts` is `pier`.
- `src/providers/claude-code.ts` loads Earendil's
  [pi-claude-code](https://github.com/earendil-works/pi-claude-code), the provider that
  sends requests through Claude Code (below).
- `src/prompt.ts` builds the system prompt from AGENTS.md files and skills, found the way
  pi finds them.
- `experiments/gate/` holds the gate: real Claude Code turns against a Durable Harness,
  each step in its own process so it can be killed.
- `experiments/wire/` measures what a conversation watch sends.
- `test/` holds offline tests, with a faux model in place of Claude: the daemon and its
  clients over a real socket, the prompt, and the provider's loading.
- `todos/` holds specs for work not yet done.
- `docs/releasing.md` says how release-please makes versions.

## Commands

```bash
direnv allow          # once; or `devenv shell`. Installs node_modules and the git hooks.
npm test              # offline unit tests (also a pre-commit hook)
npm run check         # typecheck (also a pre-commit hook)
devenv test           # both
npm run gate          # the gate: about twenty Opus turns on your Claude Code login
```

The gate prints a PASS/FAIL line per check and leaves its state directory in `/tmp`: the
SQLite storage, and every event (`transcript.jsonl`).

## Claude, through Claude Code

pier talks to Claude with Earendil's pi-claude-code. It sends each request through
`claude -p`, on Claude Code's own login, so it uses your Claude subscription. Claude
Code only talks to the model; Durable runs the tools. It's a plain pi-ai provider,
registered with `ModelRuntime.registerNativeProvider()`, so it needs nothing from pi's
extension API. Its models are `claude-code/<model>`.

Things a host must know, all found by the gate:

- **Release each conversation's warm Claude Code process.** pi-claude-code keeps one
  per conversation for straight continuations, and frees it when pi-ai's
  `cleanupSessionResources(sessionId)` is called with the conversation's provider
  session id. pi does that when a session ends; Durable never does.
- **Claude Code runs in the host's directory**, not the conversation's. The prompt
  names the conversation's directory, and Durable runs the tools there.
- **It spawns Claude Code detached**, as Durable spawns tools, so only a control-group
  kill reaps them if the host dies.
- **The prompt cache** survives an idle conversation for up to an hour: every entry is
  written with a 1-hour lifetime.

Until 2026-11-13 pier used pi-claude-bridge instead, through a shim standing in for
pi's extension API. It's in git history, and `todos/poc.md` records what it took.

## Versions

pi's packages are pinned exactly in `package.json`, all to one release (1.5.2). Pi
Durable is experimental, and breaking changes land in minor releases, so bump them
together and deliberately: read their changelogs, then run the tests and the gate.

pier doesn't follow the pi that nixpkgs ships (1.5.0 on 2026-11-12). Its packages come
from its own lockfile, so nothing ties the two together. What pier shares with classic
pi is `~/.pi/agent`: settings and credentials.

pi-claude-code isn't on npm. It's pinned to a commit, as a GitHub tarball
(`codeload.github.com`), so installs need no git and no SSH key.

## License

MIT
