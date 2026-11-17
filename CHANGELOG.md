# Changelog

## [0.6.0](https://github.com/DArtagan/pier/compare/v0.5.0...v0.6.0) (2026-11-17)


### Features

* **skills:** offer PIER_SKILLS' skill directories and each project's own, in one skills extension ([#19](https://github.com/DArtagan/pier/issues/19)) ([20bf983](https://github.com/DArtagan/pier/commit/20bf983e9f96d5dd3cd2e8b5a857fe1762381907))


### Bug Fixes

* **client:** a message from the daemon that isn't pier's closes the connection instead of crashing the client ([46c154b](https://github.com/DArtagan/pier/commit/46c154bb4b93f5ee6b6f80eab781ee00a6a56ad8))
* **daemon:** check every request against the protocol's schemas, and answer one that isn't valid with where and why ([46c154b](https://github.com/DArtagan/pier/commit/46c154bb4b93f5ee6b6f80eab781ee00a6a56ad8))
* **daemon:** refuse to start with a model it can't run, a PIER_MODEL that isn't provider/model, or a PIER_THINKING that isn't pi's ([46c154b](https://github.com/DArtagan/pier/commit/46c154bb4b93f5ee6b6f80eab781ee00a6a56ad8))

## [0.5.0](https://github.com/DArtagan/pier/compare/v0.4.0...v0.5.0) (2026-11-17)


### Features

* **tui:** Alt+Up takes queued messages back into the editor, as in pi ([64316e3](https://github.com/DArtagan/pier/commit/64316e36aa140422813c2f4519de5fe0d9d64bb2))
* **tui:** pi's command menu, with pickers for /model, /thinking, /resume, /fork and /tree ([64316e3](https://github.com/DArtagan/pier/commit/64316e36aa140422813c2f4519de5fe0d9d64bb2))
* **tui:** Up recalls a conversation's earlier messages, from every session, as in pi ([64316e3](https://github.com/DArtagan/pier/commit/64316e36aa140422813c2f4519de5fe0d9d64bb2))


### Bug Fixes

* **tui:** the client's own lines scroll away with the transcript instead of staying above the editor ([64316e3](https://github.com/DArtagan/pier/commit/64316e36aa140422813c2f4519de5fe0d9d64bb2))

## [0.4.0](https://github.com/DArtagan/pier/compare/v0.3.0...v0.4.0) (2026-11-17)


### Features

* **tui:** pi's colors for the footer and the editor's lines, and the plan's room left in green ([7d7aa30](https://github.com/DArtagan/pier/commit/7d7aa3087912e8ff7c71b34a6b2f84b51b754967))
* **tui:** pi's working line in the editor's border, and a line after each run counting its turns and time ([7d7aa30](https://github.com/DArtagan/pier/commit/7d7aa3087912e8ff7c71b34a6b2f84b51b754967))
* **tui:** the terminal's own cursor in the editor, from pi's showHardwareCursor, so an unfocused pane shows none ([7d7aa30](https://github.com/DArtagan/pier/commit/7d7aa3087912e8ff7c71b34a6b2f84b51b754967))

## [0.3.0](https://github.com/DArtagan/pier/compare/v0.2.0...v0.3.0) (2026-11-17)


### Features

* **tui:** a footer as pi's, with token totals, cost, the context gauge and the Claude plan's windows ([f8180bb](https://github.com/DArtagan/pier/commit/f8180bb1a6fbdaccd739a90f258a12f761ff1e5d))
* **tui:** Ctrl+Up and Ctrl+Down jump between your messages in fullscreen ([e46fdec](https://github.com/DArtagan/pier/commit/e46fdec5195dabe457e81a1f0d45c051660ac5c6))
* **tui:** draw answers, thinking, user messages and summaries with pi's components, with Ctrl+T to hide thinking ([f8180bb](https://github.com/DArtagan/pier/commit/f8180bb1a6fbdaccd739a90f258a12f761ff1e5d))
* **tui:** draw tool calls as pi does, edits as diffs, with Ctrl+O to expand them ([f8180bb](https://github.com/DArtagan/pier/commit/f8180bb1a6fbdaccd739a90f258a12f761ff1e5d))
* **tui:** leaving fullscreen prints the transcript into the terminal's scrollback ([e46fdec](https://github.com/DArtagan/pier/commit/e46fdec5195dabe457e81a1f0d45c051660ac5c6))
* **tui:** reconnect after the daemon restarts, resuming the transcript where it left off ([fc28809](https://github.com/DArtagan/pier/commit/fc2880943239e221c6eb6264daae34a6f05cbdc3))
* **tui:** run fullscreen by default, as pi does, with scrolling, search, and copying a mouse selection; --tui-mode regular keeps the terminal's scrollback ([e46fdec](https://github.com/DArtagan/pier/commit/e46fdec5195dabe457e81a1f0d45c051660ac5c6))
* **tui:** tool blocks in pi's colors, from the terminal's own, as pi asks for them ([f8180bb](https://github.com/DArtagan/pier/commit/f8180bb1a6fbdaccd739a90f258a12f761ff1e5d))


### Bug Fixes

* a failed attach, such as /resume of a number that isn't there, no longer leaves the pane on a frozen view ([fc28809](https://github.com/DArtagan/pier/commit/fc2880943239e221c6eb6264daae34a6f05cbdc3))
* **client:** a request on a closed connection fails at once instead of never settling ([fc28809](https://github.com/DArtagan/pier/commit/fc2880943239e221c6eb6264daae34a6f05cbdc3))
* **tui:** fill the gaps a long outage leaves, and page /earlier past its first page ([f8180bb](https://github.com/DArtagan/pier/commit/f8180bb1a6fbdaccd739a90f258a12f761ff1e5d))

## [0.2.0](https://github.com/DArtagan/pier/compare/v0.1.0...v0.2.0) (2026-11-16)


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
