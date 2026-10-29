# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

pier runs pi on Pi Durable (`@earendil-works/pi-durable`): one daemon per host owns
every session, and clients attach to it. TypeScript on Node 24, run directly with
Node's type stripping (no build step). See `README.md` for the layout and for how
pi-claude-bridge runs on Durable through `src/bridge/shim.ts`.

## Commands

- `direnv allow` once (or `devenv shell`): Node, npm install, and the git hooks.
- `npm test`: offline unit tests (vitest). `npm run check`: `tsc --noEmit`. Both run as
  pre-commit hooks, alongside biome, nixfmt, deadnix, statix, shellcheck and the
  whitespace fixers. `devenv test` runs both.
- `npm run gate`: the bridge gate, against the real Claude Code. It costs about fifteen
  Opus turns on Will's subscription, so run it when the shim, the bridge or pi's
  version changes, not as a matter of routine.
- **Larger changes go on a branch in a worktree under `.worktrees/`** (gitignored):
  `git worktree add -b <branch> .worktrees/<branch> main`. The repo is local only for
  now, with no remote; merge locally.

## Working with Pi Durable

- **Experimental, and pinned.** Every `@earendil-works/*` package is pinned to the
  version nixpkgs' `pi-coding-agent` ships (1.4.0), because dotfiles will package
  pier against it. Breaking changes land in minor releases (1.4.0 migrated SQLite
  storage to a schema 1.3.0 can't open). Bump them together, read Durable's CHANGELOG
  first, then run the tests and the gate.
- **Read the source from nixpkgs, not npm.** The npm packages ship `dist/` only. The
  nixpkgs build includes Durable's `src/`, `docs/spec.md` and runnable
  `test/examples/`, under `lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-durable/`
  of the build dotfiles uses:
  `nix build --no-link --print-out-paths ~/dotfiles#nixosConfigurations.<host>.pkgs.pi-coding-agent`.
  Durable's README is the best overview; `docs/spec.md` is normative.
- **IDs are branded numbers**, not strings (`ConversationId`, `SubmissionId`, `EntryId`).
- **An invocation's `AbortSignal` aborts when the invocation ends**, normally too
  (`scheduler.ts`, `#end`). Anything that outlives one task phase must not hold it.
  This is why the shim wraps the bridge's `streamSimple`.

## Working with pi-claude-bridge

- It ships TypeScript under `node_modules`, which Node refuses to strip, so it's loaded
  with jiti (`src/bridge/load.ts`), as pi does.
- Its debug log goes to pi's `~/.pi/agent/claude-bridge.log` unless
  `CLAUDE_BRIDGE_DEBUG_PATH` says otherwise; the gate redirects it. `CLAUDE_BRIDGE_DEBUG=1`
  turns it on. Its `syncResult: path=` lines (`clean-start`, `rebuild`, `reuse`) say whether
  a turn resumed Claude Code's session or rebuilt it from pi's history.
- It reads `~/.pi/agent/claude-bridge.json`, which dotfiles manages, for the Claude Code
  executable.

## Specs

`todos/` holds work not yet done: one spec per piece of work, with verified context and
an opening prompt, deleted once the work lands. See `todos/README.md`.
