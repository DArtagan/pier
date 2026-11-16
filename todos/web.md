# A web UI on Elanor, for this machine, the tailnet and the phone

## Opening prompt

> Read `docs/vision.md`, `docs/principles.md`, then `todos/web.md`. Build the web UI
> in the steps under "Plan". Re-check Elanor's latest release first and pin it. Do
> step 1, the deep dive into sign-in, and put its options to Will before anything
> listens beyond loopback. Keep it to the scope below and keep it thin; it's
> deprecated once p3's web UI covers the same ground. Update this spec as steps land.

Written 2026-11-16. Will's words that day: *"I'm interested in starting to improve the
TUI for day-to-day use and eventually build a web UI"*. Asked whether to decide the web
UI at the early-December check of p3: *"No, I don't want to hold off deciding until
December. Write the web ui related findings to a `web.md` todo spec."* So this is
decided soon, not in December.

## Decided

Will, 2026-11-16, answering this spec's questions:

- **Build it now:** *"Yes we do want to build it as what the future Earendil will be
  making is unclear and I'd like it sooner. If what Earendil builds covers most of the
  same ground as what we make in pier, then we'll deprecate the web ui parts of pier
  accordingly - keeping is as thin as possible. Rewrite the principles
  accordingly."* Done: `docs/principles.md`, section 1, "Exception: a web UI" and
  "What Earendil covers, pier gives up".
- **Elanor:** *"Let's use Elanor to start."*
- **Where:** *"It will be accessible locally and on the tailnet (by phone is very
  important)."*
- **Sign-in:** *"let's do a deep dive on the options when we get there."* That's step 1
  of the plan.

Until 2026-11-16, `docs/principles.md` ruled a web UI out (*"Don't build what p3 is
  centred on: sign-in, remote access, a web UI, …"*).

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

## Plan

The scope is the minimal one above: the conversations, a transcript with streaming and
tool output, a composer with send, steer, follow-up and stop, and a layout made for the
phone first. One owner; nothing for several users, nothing public, no Radius.

1. **Sign-in, a deep dive** (Will: *"when we get there"*), before anything listens
   beyond loopback. Compare the options against Will's setup:
   - a token in a private file;
   - a pairing code approved from a terminal, as p3 chose on 2026-11-16;
   - the tailnet's identity (ACLs, and whether `tailscale serve`'s identity headers
     work without HTTPS on headscale);
   - cookies and their lifetime on a phone;
   - Host and Origin checks, and DNS rebinding.

   Use `todos/wire-format.md`'s transport table and p3's slice 25 ("Decided since")
   as starting points. Put the options to Will; record his choice here.
2. **A build step and a listener on loopback.** Bundle the page with esbuild; the
   daemon serves it, and the protocol over WebSocket, on a loopback TCP port. Make the
   browser client from `src/host/client.ts`, and check that Durable's and Chord's
   client pieces really bundle for a browser.
3. **The UI on Elanor,** phone first: the conversations, the transcript, the composer.
   Pin Elanor's packages exactly.
4. **The tailnet,** with the sign-in Will chose: listen on the tailnet interface too,
   never a public one. Try it on the phone.
5. **Packaging:** the web UI comes with pier's Nix package and service
   (`todos/pi-durable.md` in dotfiles).

## Done when

Will can follow and steer a pier conversation from his phone over the tailnet, and
from a browser on the same machine, signed in as decided. Then the setup goes in
`README.md`, and this file is deleted. If p3's web UI comes to cover most of the same
ground, pier's is deprecated and removed (`docs/principles.md`, section 1).
