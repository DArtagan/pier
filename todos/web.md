# A web UI: findings, and a decision for Will

## Opening prompt

> Read `docs/vision.md`, `docs/principles.md`, then `todos/web.md`. If Will has
> answered the questions at the end (under "Decided"), carry out his choice: amend
> `docs/principles.md` as he decided, and turn this file into the build spec, or delete
> it. If he hasn't, re-check the facts marked with dates (Elanor's releases, p3's
> slice 16) and put the questions to him.

Written 2026-11-16. Will's words that day: *"I'm interested in starting to improve the
TUI for day-to-day use and eventually build a web UI"*. Asked whether to decide the web
UI at the early-December check of p3: *"No, I don't want to hold off deciding until
December. Write the web ui related findings to a `web.md` todo spec."* So this is
decided soon, not in December.

## It needs a decision against a principle

`docs/principles.md`, section 1: *"Don't build what p3 is centred on: sign-in, remote
access, a web UI, a plugin system, several users."* A web UI is p3's slice 16. A web
UI reached from the phone also brings sign-in and remote access with it. Building one
in pier means Will deciding to make an exception, recorded in the principles with its
reason and its limits. Until he does, the principle stands.

## Findings

### Elanor, Earendil's design system (checked 2026-11-16)

- **Released packages are public and licensed:**
  - `@earendil-works/elanor-react` 0.1.1 is MIT;
  - `design-tokens` 0.1.0 is ISC;
  - `elanor-icons-react` 0.1.0 (Material Symbols) is Apache-2.0;
  - `elanor-fonts` 0.1.0 (Mallos Serif, Commit Mono, Departure Mono) is OFL-1.1.

  Each tarball on npm carries its licence file, and each font has its own. They install
  from npm without a login. React components on Base UI, with precompiled CSS; React 19
  required.
- **The repository has no licence at its root** (github.com/earendil-works/elanor is
  public; GitHub detects no licence). Only the published packages are licensed, so
  copying from the repo isn't covered.
- **pkg.earendil.com is Earendil's registry of unreleased preview builds**, and needs a
  staff login. Elanor's builds from its `main` branch go there; public releases lag it.
- **It's young:** two npm releases, on 2026-11-05 and 2026-11-12. Pin exact versions.
- **Earendil's use:** p2 uses it (`elanor-react` 0.1.0, React 19). p3's web UI is to
  be on it, waiting for "the team's Elanor port" (slice 16). p3's UI may come to need
  Elanor features that aren't released yet.

### What exists already

- **p3's web UI** is slice 16, listed last before the org work, and waiting on
  Earendil's UI team. It's built on Chord's React bindings and p3's plugins, so not
  reusable by pier as it is.
- **p2's web UI** (`apps/p2/src/hosts/web/`) is under the pi repository's MIT licence.
  It's useful to read for layout and for its Elanor integration (`elanor.css`,
  `ElanorMarkdown.tsx`), not to lift: it's built on Chord's app kit.
- **For classic pi**, Will's hosts already run agegr's pi-web and Pi Remote Control
  over the tailnet (dotfiles' `modules/pi/remote.nix`). They don't see pier's
  conversations.

### What a pier web UI would take

- **A listener the browser can reach.** Browsers can't open a Unix socket, so the
  daemon would also serve HTTP and WebSocket on TCP. The protocol stays the same,
  since it's JSON over WebSocket already, chosen partly for this.
- **The browser client** is `src/host/client.ts` with the browser's own WebSocket
  instead of the `ws` package. Durable's `ConversationTranscript` and Chord's
  `applyImmutable` reach no Node modules from their entry points (checked statically,
  2026-11-16; not yet bundled for a browser).
- **A build step.** esbuild would bundle the page. pier needs a build step for its Nix
  package anyway (`todos/pi-durable.md` in dotfiles).
- **Sign-in.** On the Unix socket, file permissions decide who connects; on TCP,
  nothing does. Options:
  - loopback only, with a token from a private file;
  - a pairing code approved from a terminal, as p3 decided on 2026-11-16;
  - the tailnet's ACLs plus a token, as pi-web relies on the firewall and Pi Remote
    Control on a password.

  Any of them needs Host and Origin checks against DNS rebinding and cross-site
  requests, as `remote.nix` does for pi-web.
- **The phone.** Over the tailnet it's plain HTTP inside WireGuard. Headscale can't
  issue certificates for `tailscale serve` here (dotfiles, 2026-11-11), so there'd be
  no installable web app and no push notifications without HTTPS from elsewhere.
- **It doesn't carry over.** It's host code, replaced by p3's web UI if pier moves
  onto p3 (`docs/vision.md`). What it teaches would carry over; the code wouldn't.
- **A minimal useful scope:**
  - the conversations, newest first;
  - a transcript with streaming and tool output;
  - a composer with send, steer and follow-up, and stop;
  - a layout that works on a phone.

## Options

1. **Don't build one.** Use p3's web UI when it ships, with Will's layer as p3
   plugins; meanwhile use classic pi on the web through pi-web. No new code, and no
   exception to the principles. The cost is no web or phone access to pier
   conversations until p3's slice 16, whose timing is unknown.
2. **A small pier web UI on Elanor.** It looks like p3, with less to build (components,
   tokens, fonts). The cost: a young dependency that changes, pinned exactly, and
   releases that lag Earendil's own.
3. **A small pier web UI without Elanor:** plain React, or no framework, with a few
   styles. Fewer dependencies, and it's clearly throwaway; it looks like neither pi nor
   p3.

For 2 or 3, also decide what it reaches:

- this machine only (loopback);
- the tailnet, including the phone.

The recommendation depends on how soon Will wants web or phone access to pier's
conversations. If it's soon, option 2, kept to the minimal scope above, on the tailnet
with a pairing code or a token. If not, option 1.

## Questions for Will

1. Build a web UI in pier now (2 or 3), or not (1)?
2. If so: Elanor or not?
3. This machine only, or the tailnet and the phone?
4. Sign-in: a token in a private file, or a pairing code approved from a terminal?
5. The exception to `docs/principles.md`, section 1: what it allows (a web UI for pier's
   own conversations, on loopback and the tailnet, with one owner) and what it still
   rules out (several users, Radius, public exposure)?

## Decided

Nothing yet.
