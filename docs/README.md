# Documentation

How pier works and how to work on it, as it stands today. Descriptive, not
aspirational: if something here isn't true of pier, it's a bug in the docs. Work not yet
done lives in [`todos/`](../todos/), not here; when it lands, what it leaves behind that
is permanently true comes here, or to [`README.md`](../README.md) or
[`AGENTS.md`](../AGENTS.md).

| Doc | Contents |
|---|---|
| [vision.md](vision.md) | What pier is for, and how it changes as p3 does |
| [principles.md](principles.md) | The principles all work on pier keeps to |
| [upstream.md](upstream.md) | What pier relies on from Earendil, for the versions it runs, and where Earendil is going |
| [updating.md](updating.md) | How to move pier to a new pi release, and its dependencies with it |
| [releasing.md](releasing.md) | How release-please makes versions |
| [history.md](history.md) | Will's decisions, the gate's findings, and the wrong turns, from the proof of concept on |

[history.md](history.md) is the one file here that is **not** present tense. It earns
the exception because it holds what neither git nor the present-tense docs do: the
decisions that shaped pier and why, so they aren't relitigated, and the wrong turns, so
they aren't repeated. When a spec in `todos/` lands, a decision of lasting weight is
recorded there, and the investigation behind it stays in git with the deleted spec.
