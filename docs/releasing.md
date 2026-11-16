# Releasing

A release is a deliberate act: merging a commit to `main` releases nothing.

## How a version is made

1. Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org/).
   The `convco` commit-msg hook refuses any that do not, because release-please
   reads nothing else.
2. On every push to `main`, release-please updates a standing pull request,
   `chore(main): release X.Y.Z`. It bumps the version in `package.json` and
   `package-lock.json`, and writes `CHANGELOG.md` from the commits since the last
   release.
3. Merging that pull request tags `vX.Y.Z` and creates a GitHub release. Nothing is
   published: dotfiles packages pier with Nix.

Neither tags nor the release branch carry the package name. In
`release-please-config.json`, `include-component-in-tag` is false and `package-name`
is `""`. release-please names the branch from the package name whatever the tag
setting says, and when `package-name` is absent the node strategy reads it from
`package.json`, so the first release PR's branch was
`release-please--branches--main--components--pier`. An empty `package-name` is
kept as is (`??`, in `strategies/base.ts`); node uses the name otherwise only for
`changelog.json` and `samples/package.json`, which pier doesn't have.
`separate-pull-requests: false` would also drop it from the branch, but its
combined PR body then fails to match the package when merged, and no release is
made.

With no release yet, release-please starts at `initial-version`, 0.1.0; without
it, at 1.0.0.

Only `feat`, `fix`, `perf` and `revert` commits, and breaking changes, make a
release. The others (`docs`, `chore`, `ci`, `build`, `test`, `refactor` and
`style`) are left out of the changelog and open no release pull request
(release-please's default sections, `src/util/filter-commits.ts`, checked
2026-11-16). Below 1.0, a
breaking change bumps the minor version rather than the major, and so do `feat`
commits; `fix` bumps the patch.

Releases are immutable once published: GitHub refuses to change a release's tag
or assets. A mistaken release is fixed by the next one.

Release PRs are opened by `github-actions`, and GitHub holds CI on them at
*action required* until someone approves the run from the PR. Approving is
optional: they change only versions and the changelog, and CI runs on `main`
once one is merged. Opening them needs the repository setting *Allow GitHub
Actions to create and approve pull requests*.

## Merging a pull request

Taken from reelbarrow on 2026-11-16, where these rules were worked out.

The pull request's title decides how it is merged. GitHub writes the title into
every merge commit, and release-please reads a Conventional Commit anywhere in a
message.

- **A conventional title** (`fix: …`, `feat: …`) means **squash**. The title
  becomes the one commit on `main` and the one line in the changelog; the
  branch's own commits stay in the pull request. It is the usual case, and the
  only one where a commit-override block in the pull request's body (below) can
  correct a note after merging.
- **A plain title**, such as the branch name and a summary, means a **merge
  commit**, for when each commit on the branch belongs in the history. Those
  commits write the notes, and the title writes nothing. The lower of two
  stacked pull requests needs this: squashing it gives `main` a copy of its
  commits, which the branch above then conflicts with.

A merge commit under a conventional title puts every change in the changelog
twice. Retitle the pull request whenever the branch changes which kind it is;
only the title at merge time counts.

### Several notes from one squash

A squash gives the changelog one line, its title. A pull request that adds
several things a reader of the release notes would want to see apart lists
them instead, in a block at the end of its body:

```
BEGIN_COMMIT_OVERRIDE
feat: the daemon: one Harness per host, serving every conversation on a Unix socket
feat(tui): a terminal client that attaches to a conversation and watches it live
docs(todos): the terminal client's spec, ahead of daily use
END_COMMIT_OVERRIDE
```

- **Each line is one Conventional Commit**, and becomes one changelog entry,
  under its type's heading. The block replaces the title's entry rather than
  adding to it, so the title's own change is listed too if it still belongs.
  Entries of a hidden type (above) are parsed, and checked, but not shown.
- **It describes what the pull request leaves, not how it got there.** A branch
  that built something and replaced it before merging lists only what remains;
  merging its commits would put both in the notes.
- **It is read from the merged pull request's body** each time release-please
  runs, so it can be added or corrected after merging, until the release pull
  request is merged.
- **Its entries link to the squash commit**, not to the pull request's number.
- **The marker is only ever the block.** release-please reads everything after
  it in the body as the override, so a description that mentions it in
  passing, even in backticks, becomes an override that doesn't parse, and the
  pull request drops out of the changelog. Write "the commit-override block" in
  prose instead.
- **The squash commit's body**, which lists the branch's commits as bullets,
  adds nothing to the changelog either way.

Use it where a squash would undersell the pull request. A merge commit is for
history that belongs on `main`, not for a fuller changelog: a branch's commits
record its review, and say what changed along the way.

### When release-please can't parse a commit

release-please itself succeeds when it can't parse a commit, and leaves the
commit out of the notes. So the release workflow's `commits-parsed` job
(`.github/scripts/commits-parsed.sh`) reads its log and sets a check on the open
release pull request, *release notes: commits parsed*, before it is merged.
When it fails, correct the merged pull request's title or block, and rerun all
of the workflow's jobs (`gh run rerun <run>`), not only the failed one, so
that release-please reads them afresh; the check passes on that run. The check
is not required, so a release pull request can still be merged past it, and a
release merged so loses the entry for good.
