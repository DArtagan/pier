# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

pier runs pi on Pi Durable (`@earendil-works/pi-durable`): one daemon per host owns
every session, and clients attach to it. TypeScript on Node 24, run directly with
Node's type stripping (no build step). Claude is reached through Claude Code, with
Earendil's pi-claude-code provider. See `README.md` for the layout.

## Commands

- `direnv allow` once (or `devenv shell`): Node, npm install, and the git hooks.
- `npm test`: offline unit tests (vitest). `npm run check`: `tsc --noEmit`. Both run as
  pre-commit hooks, alongside biome, nixfmt, deadnix, statix, shellcheck and the
  whitespace fixers. `devenv test` runs both.
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
  `feat`, `fix`, `perf` and `revert` cut a release. See `docs/releasing.md`.

## Working with Pi Durable

- **Experimental, and pinned.** Every `@earendil-works/*` package is pinned exactly,
  all to one release (1.5.2). It needn't match the pi nixpkgs ships: pier gets its
  packages from its own lockfile (see README, "Versions"). Breaking changes land in
  minor releases (1.5.0 had about two dozen). Bump them together: read the
  `CHANGELOG.md` of durable, chord, ai and coding-agent first, then run the tests and
  the gate.
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

## Working with pi-claude-code

- It ships TypeScript under `node_modules`, which Node refuses to strip, so it's loaded
  with jiti (`src/providers/claude-code.ts`), as pi does. It isn't on npm: it's pinned to
  a commit as a GitHub tarball. To bump it, read its commits and `ARCHITECTURE.md`,
  change the commit in `package.json`, `npm install`, then run the tests and the gate.
- It runs `claude` from the PATH, or `PI_CLAUDE_CODE_COMMAND`, on Claude Code's own login
  (`claude auth login`). `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS` lets turns be billed to
  Extra Usage; without it they fail with a "Claude Code billing" error.
- Call pi-ai's `cleanupSessionResources(sessionId)` when a conversation goes idle or the
  host closes: Durable never does, and a conversation's warm Claude Code process
  otherwise lingers (it kept a gate host alive for 40 minutes).
- Claude Code runs in the host's working directory, detached in a process group of its
  own.

## Specs

`todos/` holds work not yet done: one spec per piece of work, with verified context and
an opening prompt, deleted once the work lands. See `todos/README.md`.
