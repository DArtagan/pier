# Updating pier

How to move pier to a new pi release, and its other dependencies with it. Written
2026-11-23, from the move to pi 1.6.0 and Node 26; amend it when an update teaches
something new.

It carries out `docs/principles.md`, section 3 ("Pin exactly, bump deliberately"), and
its aims, from Will (2026-11-23):

1. **Run on the latest official release.**
2. **Stay compatible with upstream.**
3. **Use as much of upstream as possible**, and let pier grow thinner where it can.

## Before you start

- **Work in a worktree**: `git worktree add -b pi-<version> .worktrees/pi-<version>
  main`. Leave `main`'s working tree alone; it may hold Will's uncommitted work.
- **Clone upstream into a scratch directory**, never into the repo:

  ```bash
  mkdir -p /tmp/pier-upstream && cd /tmp/pier-upstream
  git clone -q --depth 1 --branch v<old> https://github.com/earendil-works/pi pi-<old>
  git clone -q --depth 1 --branch v<new> https://github.com/earendil-works/pi pi-<new>
  git clone -q https://github.com/earendil-works/pi pi-main            # for p3
  git clone -q https://github.com/earendil-works/pi-claude-code pcc
  ```

  Two tagged clones let you diff exactly what changed in the files pier leans on.
- **Check what's published**: `npm view @earendil-works/pi-durable time --json | tail`
  and the same for the other packages. They're released together, under one version.

## 1. Read

Read everything before changing anything. Take notes as you go: they become the
commit messages, `docs/upstream.md`, and the report at the end.

- **The changelogs** of every package pier depends on, between the two versions:

  ```bash
  cd pi-<new>
  for p in durable chord ai coding-agent tui schema env; do
    echo "=== $p"
    awk '/^## \[<new>\]/{f=1} /^## \[<old>\]/{f=0} f' packages/$p/CHANGELOG.md
  done
  ```

  Breaking changes first. Then read "Added" asking whether it does something pier does
  for itself. 1.6.0's "Durable releases provider resources on close" was a fix, filed
  under none of the headings, and found only by grepping the source for
  `cleanupSessionResources`. **Grep the new source for every workaround's subject**
  (below), whatever the changelog says.
- **What pier imports**, to know which changes touch it:

  ```bash
  grep -rhn "from \"@earendil-works\|earendil-works/[a-z-]*/dist" src test experiments | sort | uniq
  ```

- **The public entries**, diffed: `packages/coding-agent/src/index.ts`,
  `packages/durable/src/index.ts`, and each package's `exports` in `package.json`. A new
  export may replace something pier copies or imports by path.
- **pier's workarounds**, each against the new source. Each one names its upstream
  gap in a comment, so list them:

  ```bash
  grep -rn "Workaround\|not exported\|isn't exported\|private in its types\|by path" src
  ```

  For each: is the gap still there? Has the code pier copies or reaches into changed?
  Diff the upstream file between the two tags. If it's unchanged and still not
  exported, update the comment's version so the next reader knows it was checked. In
  1.6.0: the theme controller, `theme`, `WorkingStatusIndicator`, the app keymap,
  `formatTokens`, `getModelSearchText`, `createInteractiveTui`, `createChatViewport`, and
  the editor's private `history` and `tryTriggerAutocomplete`.
- **pi-claude-code's commits** since the pinned one (`git -C pcc log --oneline <pin>..`)
  and its `ARCHITECTURE.md`. It isn't released; it's a commit pinned as a tarball.
- **p3**, on `main`: `git -C pi-main log --format='%h %cs %s' <last read>..HEAD --
  apps/p3`, then `apps/p3/docs/decisions.md` (newest last), `docs/README.md`, and the
  slice briefs pier tracks (3 transcript, 7 models, 8 environments, 9 prompt, 27
  terminal). The last read's commit is in `docs/upstream.md`. Look for what changes
  pier's course, and for what pier should follow now (as Node 26 was in 1.6.0).
- **The other dependencies**: `npm outdated`, then each one's release notes. And the
  toolchain: Node's release lines (`https://nodejs.org/dist/index.json`), and what
  devenv-nixpkgs offers.

## 2. Change

- **Bump every `@earendil-works/*` package together**, to the same exact version, in
  `package.json`, then `npm install`. Check that there's one copy of each:

  ```bash
  npm ls | grep earendil
  find node_modules -path "*/node_modules/@earendil-works/*/node_modules/@earendil-works/*" -maxdepth 6
  ```

  A second pi-ai would split its registries: pi-claude-code's cleanup would register on
  one copy, and Durable would call the other. pi-claude-code declares pi-ai and
  pi-coding-agent as peers, so it shares pier's.
- **Fix what the compiler finds** (`npm run check`), then **look for what it can't**.
  A breaking change can compile and still break: 1.6.0's cached `render()` arrays
  compile wherever pier only reads them, and break anywhere it changes one in place.
  Grep for each such pattern.
- **Remove what upstream now does**, when it's the same behaviour. Where upstream does
  only part of it (Durable 1.6.0 releases provider sessions on close, not on idle),
  remove that part, and say in the remaining workaround's comment what's left of the
  gap.
- **Keep the tests' behaviour.** When upstream takes over something pier did, the
  behaviour is still wanted, so the test stays, testing that it still happens,
  whoever does it. Will (2026-11-23): *"For tests though, preferably their functionality
  can stay - even in light of a new release, because the functionality they were
  testing is likely still desired. If tests must be changed/removed their should be
  some additional scrutiny."* So:
  - A test that must change or go needs its reason in the commit message, and in the
    pull request's description, for Will to look at.
  - When code goes because upstream does it, check whether a test covered it. If none
    did, add one: it guards upstream's behaviour from here on. In 1.6.0 the daemon's
    provider release had no test; it got two, one for the idle release (pier's) and
    one for the release on close (Durable's).
  - Disable the fix and watch the new test fail (`docs/principles.md`, section 5). A
    test of upstream's behaviour can't be disabled in pier, so check it catches the
    absence by reading what it records (1.6.0's close test printed the session id
    Durable released).
- **Update the dependencies with it**: Node, the dev dependencies, the other runtime
  ones. Read their release notes for breaking changes and security fixes (ws 8.23.0
  fixed a memory-exhaustion DoS). Node follows p3: 26 since 2026-11-18. When Node's
  major changes, it changes in `devenv.nix` (`pkgs.nodejs_<n>`), `package.json`'s
  `engines`, `@types/node`, `AGENTS.md`, and the README.
- **devenv**: try `devenv update`, then `devenv shell -- node --version`. If the
  shell fails to build, update inputs one at a time (`devenv update git-hooks`,
  `devenv update nixpkgs`) and keep the ones that build. On 2026-11-23,
  devenv-nixpkgs' rolling (`958ba64`) broke convco's build (libgit2-sys), so nixpkgs
  stayed at its pin, whose `nodejs_26` was 26.12.1. Try again next time.
- **Run every check inside the devenv shell**, so it runs on its Node:
  `devenv shell -- bash -c 'npm run check && npm run lint && npm run build && npm test'`.
  Outside it, `node` is the system's, which may be another major. The shell's start
  runs `npm ci`, which fails while `package.json` and the lock disagree: `npm install`
  first.

## 3. Check

In order, cheapest first; stop and fix at the first failure.

1. `npm run check`, `npm run lint`, `npm run build`, `npm test`, in the devenv shell.
2. The experiments that run offline: `node experiments/wire/sample.ts` (the wire
   format) and `node --expose-gc experiments/transcript/bench.ts` (the client with a
   long transcript). Compare the bench with `main`'s on the same Node; record a change
   worth noting in `docs/history.md`.
3. **The live store, copied**: an update that bumps a document's version can make the
   store unreadable by the old pier, so check the new one opens it, before it's let
   near the real one. Copy it with SQLite's `VACUUM INTO` (it reads a live database
   consistently; the system may have no `sqlite3`):

   ```bash
   mkdir -p /tmp/pier-store-copy/state /tmp/pier-store-copy/run && chmod 700 /tmp/pier-store-copy/run
   node -e 'const { DatabaseSync } = require("node:sqlite");
     const db = new DatabaseSync(process.env.HOME + "/.local/state/pier/pier.sqlite", { readOnly: true });
     db.exec("VACUUM INTO '\''/tmp/pier-store-copy/state/pier.sqlite'\''");'
   PIER_SOCKET=/tmp/pier-store-copy/run/pier.sock PIER_STATE_DIR=/tmp/pier-store-copy/state \
     node src/host/cli.ts daemon &
   PIER_SOCKET=/tmp/pier-store-copy/run/pier.sock node src/host/cli.ts list --all
   ```

   Every conversation should list, and the daemon's log show no reports. Then stop it,
   and delete the copy.
4. **The gate**, `npm run gate`, in the devenv shell: required for a pi bump, a
   provider bump, or a Node bump (`docs/principles.md`, section 5). About fifteen
   minutes, on Will's subscription. Record its count, Node and Claude Code versions
   (`claude --version`) in the commit message. It printed 38 checks on 2026-11-23;
   `docs/history.md` records 39 for pi-claude-code on 2026-11-13, from the same checks
   in `run.ts`, and why they differ by one wasn't found. A count that drops is worth
   explaining: compare `checks.json` in the gate's state directory with the last
   run's.
5. **By hand, in tmux**, if what a person sees changed (pi-tui, the coding agent's
   components, the theme): a real conversation with tools, Ctrl+O, a menu, `/tree`.
   Say in the pull request whether this was done.

## 4. Record

- **Commits**: one per concern, each passing the hooks on its own. The pi bump is
  `feat: run on pi <version>` (it changes what pier runs on, and cuts a release); the
  toolchain is `build: …`; the docs are `docs: …`. Each message says what changed, why,
  and what was checked, on which Node.
- **`docs/upstream.md`**: what this read found, dated, with the commit p3 was read at.
- **README, `AGENTS.md`, `docs/principles.md`**: every version number and every
  claim about upstream that changed. `grep -rn "<old version>\|never does" README.md
  AGENTS.md docs todos src` finds most.
- **`docs/history.md`**: the gate's result, and anything that went wrong.
- **dotfiles** packages pier (`pkgs/pier/package.nix`). A Node change needs its
  `nodejs` changed there when the release carrying it is packaged; say so in the
  pull request. pier doesn't change dotfiles itself.

## 5. Report

Open a pull request for Will to review: always a branch, never `main`. The
description holds:

- What changed, by package, and what was checked (and what wasn't).
- Every test that was changed or removed, and why.
- What's waiting on Will, such as dotfiles' Node.
- **What pier could remove, if Will accepted upstream's behaviour where it differs.**
  Will asked for this assessment at the end of every update (2026-11-23). For each
  part of pier that duplicates or works around upstream:
  - what it does;
  - what upstream offers instead, and how that differs, as a person would see it;
  - roughly how much code would go;
  - the risk.

  It's a proposal for Will to decide on, not a change.
