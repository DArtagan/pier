# AGENTS.md

Guidance for coding agents working in this repository.

## Overview

pier runs pi on Pi Durable (`@earendil-works/pi-durable`): one daemon per host owns
every session, and clients attach to it. TypeScript on Node 26, run directly with
Node's type stripping in development; `npm run build` compiles it for packaging. Claude is reached through Claude Code, with
Earendil's pi-claude-code provider. See `README.md` for the layout.

**Read `docs/vision.md` and `docs/principles.md` first.** The vision says what pier is
for; all work happens within the principles: keep pier thin, build so it carries over
to Earendil's p3, stay upstream-first and current, keep it local and minimal, back
claims with evidence, and leave direction to Will. Code that carries over goes in
`src/layer/`, which must never import `src/host/` (`test/layer.test.ts`).

**Change files with the edit tool**, not `sed`, `python` or other scripts: an edit
shows exactly what changed, and fails loudly when its text doesn't match.

## Commands

- `direnv allow` once (or `devenv shell`): Node, npm install, and the git hooks.
- `npm test`: offline unit tests (vitest). `npm run check`: `tsc --noEmit`. Both run as
  pre-commit hooks, alongside biome, nixfmt, deadnix, statix, shellcheck and the
  whitespace fixers. `devenv test` runs both, and the build.
- `npm run lint`: biome on `src/`, `test/` and `experiments/`; `npm run lint -- --write`
  fixes what it can. biome comes from devenv's Nix packages, not npm, so **never run
  `npx biome`**: npx finds no biome in `node_modules` and fetches `biome` from npm, an
  unrelated environment-variable tool (it leaves a `~/.biome`). Not `biome check .`
  either: it parses the `.pre-commit-config.yaml` symlink as JSON and fails.
- `npm run build`: `tsc` compiles `src/` to `dist/`, which the `pier` bin runs. Node
  won't strip types under `node_modules`, where a package lands (`buildNpmPackage` in
  dotfiles). So nothing in `src/` may lean on type stripping at run time: no `.ts` file
  read, or imported from outside `src/` (pi-claude-code's go through jiti).
- `npm run gate`: the gate, against the real Claude Code. It costs about twenty Opus
  turns on Will's subscription, and takes about fifteen minutes (a 6-minute idle
  measures the prompt cache; `PIER_GATE_IDLE_MINUTES=0` skips it). Run it when the
  provider, pi's version, or how pier drives the Harness changes, not as a matter of
  routine. It runs on an agent dir of its own (`PI_CODING_AGENT_DIR`).
- **Larger changes go on a branch in a worktree under `.worktrees/`** (gitignored):
  `git worktree add -b <branch> .worktrees/<branch> main`. It's on GitHub as
  `DArtagan/pier`; merge through a pull request, where CI runs `devenv test`.
- **Commits are [Conventional Commits](https://www.conventionalcommits.org/)**, checked
  by the `convco` hook: release-please makes versions and `CHANGELOG.md` from them. Only
  `feat`, `fix`, `perf` and `revert` cut a release. A pull request with a conventional
  title is squashed, and lists several changelog notes in a commit-override block at the
  end of its body; never name that block's marker anywhere else in the body. See
  `docs/releasing.md`, "Merging a pull request".

## Working with Pi Durable

- **Experimental, and pinned.** Every `@earendil-works/*` package is pinned exactly,
  all to one release (1.6.0). It needn't match the pi nixpkgs ships: pier gets its
  packages from its own lockfile (see README, "Versions"). Breaking changes land in
  minor releases (1.5.0 had about two dozen). Bump them together, by
  `docs/updating.md`: changelogs, pier's workarounds, p3, then the tests and the gate.
- **Read the source from a clone, not npm.** The npm packages ship `dist/` only.
  `git clone --depth 1 --branch v<version> https://github.com/earendil-works/pi` into
  a directory of its own has every package's `src/`, Durable's `docs/spec.md` and
  runnable `test/examples/`, and Earendil's own apps (`apps/p2`, `apps/p3/docs`). Durable's
  README is the best overview; `docs/spec.md` is normative.
- **IDs are branded numbers**, not strings (`ConversationId`, `SubmissionId`, `EntryId`).
- **An invocation's `AbortSignal` aborts when the invocation ends**, normally too
  (`scheduler.ts`, `#end`). Anything that outlives one task phase must not hold it.
  (The pi-claude-bridge shim, now removed, had to work around this.)
- **Shown is not stored** (1.5). Streamed text, tool output and a tool's `running`
  status reach watches before storage, by up to `settings.progress.persistWithinMs`
  (1 s). A tool slot shows `running` before its intent is stored and the tool starts,
  so a crash then reruns the call. `observeCommits()` sees only stored commits.
- **Tools run in process groups of their own** (`NodeExecutionEnv` spawns them
  detached), so killing the host's process group leaves them running; only a
  control-group kill reaps them.
- **No event stream** (1.5): render `Conversation.watch()`, whose entries are a window,
  with `ConversationTranscript` for the rest of the history.
- More of how Durable behaves (crash recovery, storage, the provider session id, tools'
  environment) and what's waiting in its next release is in `docs/upstream.md`.

## Working with pi-claude-code

- It ships TypeScript under `node_modules`, which Node refuses to strip, so it's loaded
  with jiti (`src/layer/claude-code.ts`), as pi does. It isn't on npm: it's pinned to
  a commit as a GitHub tarball. To bump it, read its commits and `ARCHITECTURE.md`,
  change the commit in `package.json`, `npm install`, then run the tests and the gate.
- It runs `claude` from the PATH, or `PI_CLAUDE_CODE_COMMAND`, on Claude Code's own login
  (`claude auth login`). `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS` lets turns be billed to
  Extra Usage; without it they fail with a "Claude Code billing" error.
- Call pi-ai's `cleanupSessionResources(sessionId)` when a conversation goes idle:
  Durable does it only for every session at `harness.close()` (1.6.0), and a
  conversation's warm Claude Code process otherwise lingers (one kept a gate host alive
  for 40 minutes).
- It starts Claude Code in `process.cwd()`, and Claude Code reports that to the model as
  its working directory. pier wraps the provider so that, inside a request,
  `process.cwd()` is the conversation's directory, which `ConversationDirectories`
  records; install that extension wherever the provider runs. Claude Code runs
  detached, in a process group of its own.

## Specs

`todos/` holds work not yet done: one spec per piece of work, with verified context and
an opening prompt, deleted once the work lands. See `todos/README.md`.
