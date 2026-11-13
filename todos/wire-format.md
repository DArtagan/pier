# Wire format and transport: options for Will to decide

## Opening prompt

> Read `todos/wire-format.md`. Will has decided the questions at its end (his answers
> are recorded under "Decided"). Fold the decisions into `todos/poc.md`'s step 2,
> delete this file, and start building the daemon.

**Interim spec**, written 2026-10-29 for Will to read and decide on, and **revised
2026-11-12** against pi 1.5.2. It's a decision report, not a plan; nothing in it is
built. When Will has answered the questions at the end, record his answers verbatim
under "Decided", carry the result into `todos/poc.md`, and delete this file.

Will, 2026-10-29: *"Please do a deep dive on wire formats, present the different
approaches to me in a report"*, and on the transport (Unix socket now, tailnet
WebSocket later): *"I don't know enough to make a decision here - please describe out
the option space for me."*

### What changed with pi 1.5 (2026-11-12)

- **Option B is gone.** Durable 1.5.0 removed `watchEvents()`. Earendil's reason: "a
  renderer renders state instead of assembling it from events … new information
  becomes a field there rather than an event type every client must learn". That's
  the case for option A, made by Durable's authors.
- **Option A got the pieces it lacked.** The view's transcript is now a window (the
  newest 50 entries, at most 100), not the whole active context, so a snapshot no
  longer grows with the conversation. `ConversationTranscript` pages older entries
  and resumes a dropped client with only what it missed.
- **Option C is a different thing now.** Chord v1, which this report described, was
  removed in 1.5.1. Chord v2 brings an app kit: server, sign-in, workers, plugins,
  and web and terminal clients. Earendil's own pi UI prototype, p2, runs on it.
- **Earendil is building this project.** p2 is a self-hosted Pi Durable server with
  web and terminal clients, and p3 ("Pi Roam") is its successor. See "Earendil's own
  server" below, and Open question 1 in `todos/poc.md`.
- **The tailnet question is answered:** headscale can't give `tailscale serve`
  certificates here (dotfiles, 2026-11-11).

## Decided

Nothing yet. Already decided elsewhere, and assumed here: one SQLite storage for all
conversations, the whole client environment passed through, and `/quit`, `/exit` and
`/detach` as proposed (all Will, 2026-10-29; see `todos/poc.md`).

## The short version

There are three separate choices, and only the first is urgent:

1. **What flows** (semantics): replicated *state*, Chord's *objects*, or someone
   else's *protocol*.
2. **How it's framed** (encoding): JSON lines, length-prefixed JSON or CBOR, or
   WebSocket messages.
3. **How clients reach the daemon** (transport): a Unix socket, SSH, TCP on
   loopback, the tailnet.

My recommendations, unchanged by 1.5:

1. **State plus commands.** Clients get Durable's own conversation view, then the
   operations of each change, and send commands (submit, abort, configure, …). Every
   Earendil prototype has rendered this view, and Durable now offers nothing else.
2. **JSON in WebSocket messages**, on every transport. It's one code path, a browser
   can use it unchanged later, and `websocat` can debug it. p2 does the same (`ws`).
3. **A Unix socket only, for now.** Reach other hosts over SSH until a web or phone
   client exists, and decide the remote listener and its sign-in then.

**Speak ACP later, through an adapter.** The Agent Client Protocol is an open
standard with a large client ecosystem (Zed, Neovim, Emacs, JetBrains, phone and web
apps). It fits as a translator in front of pier's protocol, not as pier's own
protocol.

## What the protocol has to carry

Server to client:

- **The conversation, live:** the transcript, the streaming partial answer, running
  tool output, the inbox (queued steers and follow-ups), usage and cost, the agent's
  model and thinking level, compaction status, and why the last run failed. All of it
  is state in Durable (`ConversationView`: an entry window plus the `pi.live`,
  `pi.inbox`, `pi.usage`, `pi.agent` and `pi.provider` documents; `pi.live.runFailure`
  since 1.5).
- **Lists:** conversations, for `/resume` (filtered by cwd), forks and subagents, and
  the task graph (`Harness.watchTaskGraph()`).
- **Notices:** the bridge's `ctx.ui.notify`, errors, and Harness reports.
- **Older history**, page by page: `Conversation.entries()`, which
  `ConversationTranscript` drives on the client (1.5).

Client to server:

- submit (prompt, steer or follow-up; text and images; a `requestId`, which makes
  retries idempotent in Durable), continue after a failed run (`type: "continue"`,
  1.5), withdraw a queued item, abort, compact, reset (`/new`), fork, and configure
  (model, thinking)
- page older entries (the transcript's loader)
- attach and detach, with the client's environment on attach (decided)
- `!` bash, which runs in the conversation's environment, not the client's
- `@file` completion. A local pane can list files itself, but a web or phone client
  can't.

Properties:

- **Several clients on one conversation**, all live (the PoC's "gained" behaviour).
  Each watch has its own window.
- **Late join and reconnect** start from the newest window, or with
  `transcript.resume`, from where the client left off when that still fits (1.5).
  Nothing else is replayed.
- **Slow clients:** a watch folds what arrived while its listener ran into one
  delivery; past 10,000 pending operations it sends one whole-value replacement (1.5;
  it was 100 frames).
- **Snapshot size:** the documents, plus 50–100 entries (1.5). Before, it was the
  whole active context, which can be megabytes on a 1M-token window; your classic pi
  session files reach 1.4–3 MB (measured 2026-10-29). Images are base64 inside it.
  p3's notes put a budget on bytes per common action, after a page switch in p2
  fetched 1.5 MiB (`apps/p3/docs/efficiency.md`).
- **Restarts:** a daemon restart drops every connection. Clients reconnect, resume
  their transcripts, and Durable resumes the work.
- **Shown is not stored** (1.5): streamed text, tool output and a tool's `running`
  status reach watches before storage, by up to a second. A client can show a tool
  as running that a crash then reruns from the start (gate, 2026-11-12).

## Measured: what a watch sends

`experiments/wire/sample.ts` runs one faux turn (a bash tool call that prints three
lines 0.2 s apart, then an answer) and prints what `Conversation.watch()` sends, as
JSON lines.

| | Attached before the turn | Joining mid-tool |
|---|---|---|
| View operations, Durable 1.4.0 (2026-10-29) | 13 frames, 6.2 KB | 8 frames, 5.8 KB |
| View operations, Durable 1.5.2 (2026-11-12) | 13 frames, 6.2 KB | 8 frames, 5.8 KB |
| Agent events (`watchEvents()`), 1.4.0 only | 26 frames, 10.6 KB | 15 frames, 6.8 KB |

About half the bytes (70% of the late join's) are the system entry, which carries the
four tool schemas once per context. Events were about 40% larger: they sent each
message at both `message_start` and `message_end`.

What operations look like (trimmed), one line per delivery: `s` set, `a` string
append, `d` delete, `p` array splice. Unchanged in 1.5, apart from new fields such as
`run.turns`:

```json
{"view":{"conversation":{"id":1},"entries":[],"docs":{"pi.agent":{…},"pi.live":{},"pi.inbox":{"items":[]},…}}}
{"ops":[["s",["docs","pi.live","run"],{"taskId":9,"inputs":[8],"turns":0,"first":7}],["p",["entries"],0,0,[{"kind":"pi.user",…}]]]}
{"ops":[["s",["docs","pi.live","tools",0,"output"],"line 1\n"]]}
{"ops":[["a",["docs","pi.live","tools",0,"output"],"line 2\n"]]}
{"ops":[["d",["docs","pi.live","run"]],["d",["docs","pi.live","generation"]],["s",["docs","pi.usage",…],725]]}
```

## Earendil's own server: p2, and p3 ("Pi Roam")

Found 2026-11-12 in the pi repo at v1.5.2, under `apps/`; neither is published.

- **p2** is "a self-hosted Pi Durable UI built from independent Chord plugins", on
  Chord v2's app kit:
  - a server, with a worker process per session that stops after 5 minutes idle
  - a web UI, and a TUI whose code the server sends, run in a sandboxed worker on
    your machine (Node 26.5.1 or newer)
  - owner sign-in: a one-time link, an owner key in a private data directory,
    cookies, device pairing
  - loopback only; remote access through an HTTPS tunnel or reverse proxy with an
    allow-list of hosts, or through Earendil's Radius relay

  Its README opens with: **"p2 is a prototype. It will be gone soon. … Do not build
  on it or run it for anything you depend on."**
- **p3** is its successor, in design (`apps/p3/docs/`): "your own Pi instance, fully
  extensible", with the instance as the trust boundary and Radius for backups and
  remote access. Its owner's first rules: reloads without restarts, and small steps.
  It has no code yet.
- **What it means here:** state, not events, on the wire (p2 renders Durable's view);
  Chord v2 is where Earendil is putting its server, sign-in and client machinery; and
  their remote story is loopback plus a tunnel or relay, not a listener on the
  network. Neither loads pi extensions, so pi-claude-bridge wouldn't run on them as
  it is.

## Option space 1: what flows

### A. Durable's view: state plus commands (recommended)

The server sends `Conversation.watch()` output: the view, then the operations of each
delivery. Clients apply them with Chord's `applyImmutable`
(`@earendil-works/chord/delta`), keep their transcript with
`ConversationTranscript`, and render. Commands go the other way as requests with
responses.

- **Prior art:** all of Earendil's. The v1.0.0 Durable demo rendered its TUI from the
  view through a `DurableView` / `DurableController` split. The v1.1.0 client/server
  stack served the same view as a `Transcript` service, plus an `AgentController`
  service for prompt, steer, follow-up, cancel, abort and compact. p2 renders it
  today.
- **For:**
  - It's exactly what Durable commits, so the daemon keeps no reducer. A late
    joiner and an old client are consistent by construction.
  - It's the smallest format measured, and with 1.5's window it stays small.
  - It covers every document generically: a new document is new state, not a new
    message type.
  - It's the only thing Durable offers since 1.5.
- **Against:**
  - The format is Durable's internals (`pi.live`'s shape, entry records), and Durable
    is experimental with breaking changes in minor releases (1.5.0 alone changed the
    listener, `pi.live`'s version, and the window). Every client is tied to the
    daemon's Durable version.
  - Clients need Chord's delta codec. It's small, but a non-JavaScript client would
    reimplement it.
- **Why the coupling is acceptable:** first-party clients (the TUI now, a web UI
  served by the daemon later) ship in the same package as the daemon, so they always
  match. Only third-party clients need a stable surface, and an adapter can give them
  one (see E).

### ~~B. Durable's agent events (`watchEvents()`)~~

Removed in Durable 1.5.0 (above). Durable's changelog maps each former event to the
state that replaces it, for a client that wants to show "what just happened".

### C. Chord v2's app kit

The daemon is a Chord v2 server (`startServer`), conversations are objects its
plugins serve, and clients are Chord hosts: a page through `startPage`, a terminal
through `startTerminal`.

- **For:** most of a server comes built in:
  - owner sign-in, sessions, device pairing, and private data-directory handling
  - flow control, pings, reconnection, and compression
  - per-session worker processes, which isolate crashes
  - plugins with hot reload, which would end the "restarts interrupt every pane"
    problem
  - web and terminal clients, themes, and languages
  - telemetry

  It's what Earendil uses, so pier could follow p3 more easily.
- **Against:**
  - It's very new and moving fast. v1 was removed in 1.5.1, weeks after Earendil
    built its 1.1.0 server on v1 and withdrew it. v2's app kit is numbered by "slice"
    and still changing.
  - Clients must be Chord hosts, so JavaScript only in practice, and its terminal
    surface needs Node 26.5.1 or newer (pier and your system run 24).
  - p2, the one app on it, warns against building on it.
  - It's far more than a PoC daemon needs.
- **Middle path:** A uses Chord's delta codec without the app kit. If pier later
  moves to Chord v2, or onto p3, the state on the wire is the same.

### D. pi's RPC protocol (`pi --mode rpc`)

JSONL commands, responses and events over a child process's stdin and stdout,
documented in pi's `docs/rpc*.md` and `json.md`.

- **For:** it's documented, works from any language, and already has clients:
  `RpcClient`, and the several pi-acp adapters, which drive pi through it.
- **Against:** it was designed for one pi process with one session file:
  - `switch_session`, `get_tree` and `get_entries` speak pi's JSONL session format,
    and forks and tree navigation work differently there than in Durable.
  - It has no snapshot, so no late join, and no idea of several clients.
  - Its extension-UI round trips assume extensions pier doesn't load.

  Emulating it means translating a protocol built for another engine. Not
  recommended as pier's protocol, though classic pi keeps it.

### E. ACP, the Agent Client Protocol (as an adapter)

ACP v2 is JSON-RPC 2.0. The client calls `initialize`, `session/new`,
`session/list`, `session/resume` (optionally replaying history), `session/prompt` and
`session/cancel`. The agent sends `session/update` notifications (message chunks,
tool calls, plans, config options, compactions, notices) and permission requests.
(Not re-checked on 2026-11-12.)

- **Ecosystem** (agentclientprotocol.com/get-started/clients, 2026-10-29): Zed,
  JetBrains, Neovim (CodeCompanion, avante, agentic.nvim), Emacs (agent-shell), VS
  Code extensions, Obsidian, terminal clients (Toad and others), and desktop, web and
  phone apps ("ACP UI" lists iOS, Android and web). Several pi-acp adapters exist for
  classic pi.
- **Against it as pier's own protocol:**
  - Its only standard transport is stdio: the client launches the agent as a
    subprocess. A remote transport (long-lived HTTP streams or WebSocket) is still an
    RFD.
  - Its update vocabulary is coarser than pi's: no inbox, no task graph, nothing
    like `pi.live`. pi's footer and parity features would need `_meta` extensions.
  - It has no notion of several clients watching one session live.
- **As an adapter, it's a good fit:** a `pier acp` command speaks ACP on stdio to
  the editor and pier's own protocol to the daemon. Zed (which you configure in
  dotfiles) would then attach to daemon conversations, and an ACP phone client could
  follow once ACP's remote transport lands.
- **No decision needed now**, beyond keeping A's command set close enough to ACP's
  that the adapter stays thin.

### F. Bespoke events and state

Design pier's own vocabulary, as durable-pi did (its `dpi-sdk` "v1 wire contract",
with `AgentModel` / `SessionModel` reducers).

- **For:** a stable, app-owned contract, decoupled from Durable's internals.
- **Against:** the most design and maintenance, and a reducer on both sides, which
  is what Durable itself just stopped doing. A buys most of the same benefits for
  first-party clients without the work, and E gives third parties a stable surface.

### Not considered further

- **AG-UI** (CopilotKit's agent–user protocol): HTTP and server-sent events for web
  apps, organized around runs. It could be a later web adapter, but offers nothing a
  TUI needs.
- **MCP and A2A** cover agent-to-tool and agent-to-agent traffic, not a user
  interface.

## Option space 2: framing

| Framing | For | Against |
|---|---|---|
| JSON lines | Simplest. `socat` + `jq` debugging. pi's RPC uses it. | Needs care with U+2028 / U+2029 (pi's docs warn Node's `readline` splits on them). Images go as base64. Browsers can't speak it. |
| Length-prefixed JSON or CBOR | Robust framing. CBOR carries images as bytes (Earendil's v1.1.0 choice, with 16 MiB frames). | Custom. CBOR isn't human-readable. Browsers need a WebSocket anyway. |
| **WebSocket messages, JSON** (recommended) | Framing built in. One codec for the Unix socket (`ws` serves on a socket path), TCP, and browsers. `websocat` debugging. p2 uses `ws` too, and Chord v2's links run over WebSockets, if C is ever wanted. | A dependency (`ws`), and a handshake on local connections. |

## Option space 3: transport (decision 2)

How a client reaches the daemon, and what stands in for sign-in in each case:

| Transport | Reaches | Authentication | Notes |
|---|---|---|---|
| **Unix socket** in `$XDG_RUNTIME_DIR/pier/` | Panes on this host | File permissions (the directory is 0700). The kernel can also report the peer's uid (`SO_PEERCRED`). | Nothing listens on a network. systemd can socket-activate it, starting the daemon on the first connection. Earendil's v1.1.0 stack used exactly this. |
| **SSH** | Terminals on other hosts | Your SSH keys | Two forms: run the client remotely (`ssh <host> pier`, the simplest), or forward the socket (`ssh -L /tmp/pier.sock:/run/user/1000/pier/pier.sock`, supported since OpenSSH 6.7). Adds no new attack surface. |
| **TCP on loopback** | Browsers on this host | A token, plus Origin and Host checks against DNS rebinding and cross-site requests | Browsers can't open Unix sockets, so a web UI needs this. `modules/pi/remote.nix` already does exactly these checks for pi-web and Pi Remote Control. p2 listens only here, and adds sign-in by one-time owner links and an owner key that only the server's user can read. |
| **The tailnet** (bind `tailscale0`, or put `tailscale serve` in front) | Phone and other devices on the tailnet | Tailnet ACLs, plus a token | **Checked 2026-11-11** (dotfiles' `modules/pi/README.md`): headscale can't issue certificates for `tailscale serve` here. Support is on headscale's main branch but in no release, and it solves ACME DNS-01 through a public DNS zone, which `forge.local` isn't. So it's plain HTTP on the tailnet (WireGuard-encrypted) plus a token, as pi-web is today: no push notifications, and no installable web app. Whether `serve`'s identity headers work without HTTPS is unchecked. |
| **A tunnel or relay** to loopback | Anywhere | The tunnel's, plus the server's own sign-in | p2's answer: an HTTPS reverse proxy that keeps the public Host header, or Radius. Gives HTTPS without headscale's certificates, at the cost of a public endpoint or a third party. |
| **ACP's stdio, through `pier acp`** | Editors | Whoever can run `pier acp` | Not a daemon listener: the adapter itself connects to the Unix socket. |

How they combine:

- **Now:** the Unix socket, and SSH for other hosts.
- **When a web UI exists:** add one HTTP/WebSocket listener on loopback, with sign-in
  decided then, and reach it from other devices over the tailnet, or a tunnel if it
  needs HTTPS.

Because everything is JSON in WebSocket messages, the protocol doesn't change between
them; only the listener and the sign-in do.

## Questions for Will

1. **Semantics:** A (Durable's view plus commands; recommended), C (Chord v2's app
   kit), or F (bespoke)? B no longer exists. Your answer to `todos/poc.md`'s Open
   question 1 (pier or Pi Roam) bears on this: C is the way to stay close to p3.
2. **Envelope:** for A, a minimal pier-owned JSON envelope (requests with ids,
   responses, subscriptions; recommended), or Chord v2 from the start?
3. **Framing:** JSON in WebSocket messages everywhere (recommended), or JSON lines
   on the Unix socket and WebSocket only where browsers need it?
4. **Transport for step 2:** the Unix socket only, with SSH for other hosts
   (recommended), deferring the remote listener and its sign-in to the web client?
5. **ACP:** worth a later step (`pier acp`, so Zed and ACP apps can attach)? If
   so, it goes in `todos/poc.md`'s build order after the TUI.

## Sources

- Durable 1.5.2's `CHANGELOG.md` (1.5.0–1.5.2), README, and `src/harness/`
  (`tool.ts`, `live.ts`, `transcript.ts`), from a read-only clone of
  earendil-works/pi at `v1.5.2`. The 2026-10-29 version read Durable 1.4.0's
  README, `src/harness/view.ts` and `events.ts` from nixpkgs' build.
- Chord 1.5.2's `CHANGELOG.md` (v2, the app kit). The 2026-10-29 version read Chord
  1.4.0's README, `docs/guide.md` and `docs/spec.md` §12.
- p2 and p3: `apps/p2/README.md`, `apps/p2/docs/p2-notes.md`, and
  `apps/p3/docs/` (`status-2026-11-09.md`, `direction-pi-roam.md`, `decisions.md`,
  `efficiency.md`) at `v1.5.2`.
- pi v1.1.0, cloned read-only: `packages/{protocol,server,client}/README.md` and
  `packages/coding-agent/src/experimental/` (`services/README.md`,
  `services/transcript.ts`, `services/agent-controller.ts`, `durable/runtime.ts`).
  pi v1.2.0's `packages/coding-agent/CHANGELOG.md` for the removal.
- pi 1.4.0's `docs/rpc.md`, `rpc-commands.md` and `json.md`.
- ACP: <https://agentclientprotocol.com/protocol/v2/overview>,
  <https://agentclientprotocol.com/protocol/v2/transports>,
  <https://agentclientprotocol.com/get-started/clients>, and the remote transport RFD
  (`docs/rfds/streamable-http-websocket-transport.mdx` in
  agentclientprotocol/agent-client-protocol). pi-acp adapters: Attamusc, regadas,
  victor-software-house, xintaofei on GitHub.
- disler/durable-pi: <https://github.com/disler/durable-pi> and its
  `apps/dpi-sdk/README.md`.
- AG-UI: <https://docs.ag-ui.com/introduction>.
- Headscale and `tailscale serve`: dotfiles' `modules/pi/README.md` (commit 1bc47b6,
  2026-11-11).
