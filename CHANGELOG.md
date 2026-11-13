# Changelog

## [0.2.0](https://github.com/DArtagan/pier/compare/v0.1.0...v0.2.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* src/bridge/ is gone; createPrompt() returns the extension itself.

### Features

* add Earendil's pi-claude-code as a provider, and gate it like the bridge ([dd44453](https://github.com/DArtagan/pier/commit/dd44453f3fb584c1edc45f22316b43eae6c6c74e))
* talk to Claude through pi-claude-code only, and drop pi-claude-bridge ([f4d1b46](https://github.com/DArtagan/pier/commit/f4d1b467abffd8b76460796093a0b4ee17d759a0))
* the thin slice: a daemon on a Unix socket, and a terminal client ([4e9765d](https://github.com/DArtagan/pier/commit/4e9765d4cc69cf44c54328e0867651e8df05ed01))


### Bug Fixes

* number conversations [#1](https://github.com/DArtagan/pier/issues/1), [#2](https://github.com/DArtagan/pier/issues/2), ... instead of showing Durable's ids ([07f710d](https://github.com/DArtagan/pier/commit/07f710df893acb628ff49b4f6140ebf00882f859))
* run Claude Code in each conversation's directory ([aa67581](https://github.com/DArtagan/pier/commit/aa67581cd16ccb276ace917e38971444aa1e7b3c))

## 0.1.0 (2026-11-03)


### Features

* run pi-claude-bridge on a Pi Durable Harness, through a shim ([01c99dd](https://github.com/DArtagan/pier/commit/01c99dd55aaa68bbeb98d0e7b4f244ded232f48f))


### Bug Fixes

* **shim:** end the bridge's signal when a run ends, so Esc mid-tool closes Claude Code ([16dae4c](https://github.com/DArtagan/pier/commit/16dae4c1e98f48334dcac92ccdfc4bec40e28da0))
