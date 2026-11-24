# Changes to raise upstream, once pier has settled

## Opening prompt

> Read `docs/principles.md` (section 3, "Upstream first, and current"), then
> `todos/upstream.md`. Will has decided to raise one or more of the changes below.
> For the one he names, re-check its gap against the newest pi and pi-claude-code
> (the gap may have closed), then draft the issue: the problem, a concrete example
> from pier, and the smallest change. Show Will the draft. Nothing is filed until he
> says so, and filing is his to do or to OK each time.

Written 2026-11-24. **On hold, by Will's decision** (2026-11-24): *"I presently have no
interest in raising outward-facing upstream changes. ... note them ... as future
opportunities for me to tackle once pier has stabilized more."* Nothing here is to be
raised until he picks it up.

Each is a gap pier works around today. An upstream change would take the workaround
away with no change in what a person sees. Each workaround's comment in the code names
its gap, so `docs/updating.md` re-checks them on every update; when one closes
upstream, pier drops the workaround and the entry here goes.

## The changes

### Durable: release provider resources when a conversation idles

- **The gap.** pi-claude-code keeps a warm Claude Code process per conversation until
  pi-ai's `cleanupSessionResources(sessionId)` names it. pi does that when a session
  ends. Durable does it only for every session at `harness.close()` (since 1.6.0,
  #11961), so a daemon that stays up holds one process for every conversation used
  since it started. pi-claude-code's own 5-minute limit (`CLAUDE_PROCESS_MAX_AGE_MS`)
  didn't hold: one kept a gate host alive 40 minutes past it (`docs/history.md`).
- **pier's workaround.** `src/host/daemon.ts` watches `pi.live` and releases a
  conversation's session five minutes after its run ends (`releaseAfterMs`), about 30
  lines. Tested in `test/daemon.test.ts`, "provider resources".
- **The change.** Durable releasing a conversation's provider session after it has
  been idle a while. It already tracks idleness for `settings.contextRetentionMs`
  (ten minutes by default, for a conversation's cached context), so a setting beside
  it, or the same one, would fit.
- **Where.** `packages/durable` belongs to Mario (p3's `docs/process.md`).

### pi: export the theme controller and theme

- **The gap.** pi's default "system" theme takes tool blocks' backgrounds from the
  terminal's own colors, which `InteractiveThemeController` asks the terminal for
  (OSC 10, 11 and 4); it also follows light and dark switches. Neither it nor the
  `theme` instance is exported from `@earendil-works/pi-coding-agent`.
- **pier's workaround.** `src/host/theme.ts` and `src/host/colors.ts` import both
  from pi's `dist/` by path, about 95 lines. A pi release that moves those files
  breaks the client's colors at run time, not at compile time.
- **The change.** Export `InteractiveThemeController` (or `setTerminalColors`) and
  `theme` from the package's entry, beside `initTheme`, which is already exported.
- **Related, smaller.** Also not exported, and rebuilt by pier: `formatTokens`,
  `getModelSearchText`, `WorkingStatusIndicator`, the app keymap (`KEYBINDINGS`),
  `createInteractiveTui` and `createChatViewport`. One request could list them all.

### pi-claude-code: a working directory per request

- **The gap.** pi-claude-code starts Claude Code in `process.cwd()`, and Claude Code
  tells the model that's its working directory. In a daemon serving conversations in
  many directories, that's the daemon's, and Claude noticed it didn't match the
  conversation's (`docs/history.md`). Nothing in a pi-ai request carries a directory.
- **pier's workaround.** `src/layer/claude-code.ts`: `ConversationDirectories`
  records each conversation's directory by its provider session id, and the provider
  runs each request with `process.cwd()` patched, inside an `AsyncLocalStorage`
  scope, to answer it. About 60 lines; it patches a process global.
- **The change.** A provider option, or a request option, for the directory Claude
  Code runs in: a `cwd` in pi-claude-code's options, or a resolver from the session
  id.
- **Where.** `earendil-works/pi-claude-code`, which has had no commits since
  2026-11-05.

### pi-claude-code: a recorded environment block that goes stale

Found 2026-11-24 (`todos/environment.md`, "How Claude Code's environment block is
made, and kept"; `experiments/cwd/`).

- **The gap.** pi-claude-code records Claude Code's environment and date messages on a
  conversation's first request and replays them for the rest of the conversation, to
  keep the prompt cache warm. It records them afresh only when the model changes. So the
  model is told the first day's date for as long as the conversation lasts (in Will's
  store, 498 of 1,746 answers were given under a stale date; one conversation ran a
  week on its first day's), and after a change of directory, the old directory.
- **pier's workaround** (decided by Will, 2026-11-24; not built yet). pier adds Claude
  Code's own `# Environment update` wording as a note when the directory or the day
  changes (about 30 to 100 tokens, cache kept). The block itself stays stale. A tested
  alternative, kept in reserve, strips the recording when the directory differs, at the
  cost of one full cache write (`experiments/cwd/act.ts`, `refresh`); it depends on
  pi-claude-code's private replay format.
- **The change.** Either drop the recording when the `cwd` differs, as already done when
  the model differs; or, cheaper, insert Claude Code's own `# Environment update`
  message (directory, date) where the change happened, keeping the recorded prefix.
- **Where.** `earendil-works/pi-claude-code`, with the working-directory gap above.

### pi-tui: the editor's history and menu, without private members

- **The gap.** pier reaches two private members of pi-tui's `Editor`: it clears
  `history` when the client switches conversations (the editor can only add to it),
  and calls `tryTriggerAutocomplete()` to open a command's argument menu.
- **pier's workaround.** `fillHistory` in `src/host/tui.ts`, and `openArguments` in
  `src/host/commands.ts`, both kept by Will's decision (`docs/history.md`). A pi-tui
  release that renames either member would break them without a type error; a test in
  `test/commands.test.ts` fails if it does (checked by renaming each).
- **The change.** A public `setHistory(entries)` (or `clearHistory()`) on the editor,
  and a public way to open the menu, as typing does.
