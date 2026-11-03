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
release. For the `node` release type `docs`, `chore`, `ci`, `test` and `refactor`
are left out of the changelog and open no release pull request. Below 1.0, a
breaking change bumps the minor version rather than the major, and so do `feat`
commits; `fix` bumps the patch.

Releases are immutable once published: GitHub refuses to change a release's tag
or assets. A mistaken release is fixed by the next one.

Release PRs are opened by `github-actions`, and GitHub holds CI on them at
*action required* until someone approves the run from the PR. Approving is
optional: they change only versions and the changelog, and CI runs on `main`
once one is merged. Opening them needs the repository setting *Allow GitHub
Actions to create and approve pull requests*.
