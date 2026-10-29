# Wire format and transport: options for Will to decide

## Opening prompt

> Read `todos/wire-format.md`. Will has decided the questions at its end (his answers
> are recorded under "Decided"). Fold the decisions into `todos/poc.md`'s step 2,
> delete this file, and start building the daemon.

**Interim spec**, written 2026-10-29 for Will to read and decide on. It's a decision
report, not a plan; nothing in it is built. When Will has answered the questions at
the end, record his answers verbatim under "Decided", carry the result into
`todos/poc.md`, and delete this file.

Will, 2026-10-29: *"Please do a deep dive on wire formats, present the different
approaches to me in a report"*, and on the transport (Unix socket now, tailnet
WebSocket later): *"I don't know enough to make a decision here - please describe out
the option space for me."*

## Decided

Nothing yet. Already decided elsewhere, and assumed here: one SQLite storage for all
conversations, the whole client environment passed through, and `/quit`, `/exit` and
`/detach` as proposed (all Will, 2026-10-29; see `todos/poc.md`).

## The short version

There are three separate choices, and only the first is urgent:

1. **What flows** (semantics): replicated *state*, a stream of *events*, or someone
   else's *protocol*.
2. **How it's framed** (encoding): JSON lines, length-prefixed JSON or CBOR, or
   WebSocket messages.
3. **How clients reach the daemon** (transport): a Unix socket, SSH, TCP on
   loopback, the tailnet.

My recommendations:

1. **State plus commands.** Clients get Durable's own conversation view as a
   snapshot followed by the exact operations of each commit, and send commands
   (submit, abort, configure, …). This is what both of Earendil's prototypes did,
   and it's the cheapest route to the TUI.
2. **JSON in WebSocket messages**, on every transport. It's one code path, a browser
   can use it unchanged later, and `websocat` can debug it.
3. **A Unix socket only, for now.** Reach other hosts over SSH until a web or phone
   client exists, and decide the tailnet listener and its authentication then.

**Speak ACP later, through an adapter.** The Agent Client Protocol is an open
standard with a large client ecosystem (Zed, Neovim, Emacs, JetBrains, phone and web
apps). It fits as a translator in front of pier's protocol, not as pier's own
protocol.

## What the protocol has to carry

Server to client:

- **The conversation, live:** the transcript of the active context, the streaming
  partial answer, running tool output, the inbox (queued steers and follow-ups),
  usage and cost, the agent's model and thinking level, and compaction status. All of
  it is committed state in Durable (`ConversationView`: entries plus the `pi.live`,
  `pi.inbox`, `pi.usage`, `pi.agent` and `pi.provider` documents).
- **Lists:** conversations, for `/resume` (filtered by cwd), forks and subagents, and
  the task graph.
- **Notices:** the bridge's `ctx.ui.notify`, errors, and Harness reports.
- **Older history**, page by page. The view holds only the active context, since the
  newest compaction or reset (`ContextView.entries`). Earendil's prototype listed
  "a paging method over `Conversation.entries()`" as a TODO.

Client to server:

- submit (prompt, steer or follow-up; text and images; a `requestId`, which makes
  retries idempotent in Durable), withdraw a queued item, abort, compact, reset
  (`/new`), fork, and configure (model, thinking)
- attach and detach, with the client's environment on attach (decided)
- `!` bash, which runs in the conversation's environment, not the client's
- `@file` completion. A local pane can list files itself, but a web or phone client
  can't.

Properties:

- **Several clients on one conversation**, all live (the PoC's "gained" behaviour).
- **Late join and reconnect** start from a fresh snapshot. Durable's watches already
  work this way, and nothing is replayed.
- **Slow clients:** Durable keeps at most 100 undelivered frames per watch, then
  replaces them with one frame holding the whole newest view.
- **Snapshot size:** a snapshot is the active context, which can be megabytes on a
  1M-token window. Your classic pi session files reach 1.4–3 MB (measured
  2026-10-29). Images are base64 inside it.
- **Restarts:** a daemon restart drops every connection. Clients reconnect and get a
  fresh snapshot, and Durable resumes the work.

## Measured: Durable's two watch formats

`experiments/wire/sample.ts` runs one faux turn (a bash tool call that prints three
lines 0.2 s apart, then an answer) and prints what each watch API emits as JSON
lines. Measured 2026-10-29, Durable 1.4.0:

| Format | Attached before the turn | Joining mid-tool |
|---|---|---|
| View operations (`Conversation.watch()`) | 13 frames, 6.2 KB | 8 frames, 5.8 KB |
| Agent events (`watchEvents()`) | 26 frames, 10.6 KB | 15 frames, 6.8 KB |

About half the bytes (70% of the late join's) are the system entry, which carries the
four tool schemas once per context. Operations are about 40% smaller over a whole
turn: events send each message at both `message_start` and `message_end`, and the
system entry and tool results go twice, or three times with `tool_execution_end`.

What they look like (trimmed). View operations, one line per commit: `s` set, `a`
string append, `d` delete, `p` array splice:

```json
{"view":{"conversation":{"id":1},"entries":[],"docs":{"pi.agent":{…},"pi.live":{},"pi.inbox":{"items":[]},…}}}
{"ops":[["s",["docs","pi.live","run"],{"taskId":9,"inputs":[8]}],["p",["entries"],0,0,[{"kind":"pi.user",…}]]]}
{"ops":[["s",["docs","pi.live","tools",0,"output"],"line 1\n"]]}
{"ops":[["a",["docs","pi.live","tools",0,"output"],"line 2\n"]]}
{"ops":[["d",["docs","pi.live","run"]],["d",["docs","pi.live","generation"]],["s",["docs","pi.usage",…],725]]}
```

Agent events, named after pi's own:

```json
{"type":"snapshot","entries":[],"tools":[],"inbox":[],"agent":{…},"usage":{…}}
{"type":"run_start","inputs":[8]}
{"type":"tool_execution_start","toolName":"bash","args":{"command":"…"}}
{"type":"tool_execution_update","toolName":"bash","output":{"append":"line 2\n"}}
{"type":"message_end","entry":{"model":[{"role":"assistant",…}]}}
{"type":"run_end","inputs":[8]}
```

## Option space 1: what flows

### A. Durable's view: state plus commands (recommended)

The server sends `Conversation.watch()` output: the view, then the operations of each
commit. Clients apply them with Chord's `applyImmutable` (`@earendil-works/chord/delta`)
and render the result. Commands go the other way as requests with responses.

- **Prior art:** Earendil's own. The v1.0.0 Durable demo rendered its TUI from
  `viewState()` through a `DurableView` / `DurableController` split. The v1.1.0
  client/server stack served the same view as a `Transcript` service, plus an
  `AgentController` service for prompt, steer, follow-up, cancel, abort and compact.
  Both read Durable's view; neither used events.
- **For:**
  - It's exactly what Durable commits, so the daemon keeps no reducer. A late
    joiner and an old client are consistent by construction.
  - It's the smallest format measured.
  - It covers every document generically: a new document is new state, not a new
    event type.
  - Porting the v1.0.0 `tui.ts` (step 3) means keeping its input format.
- **Against:**
  - The format is Durable's internals (`pi.live`'s shape, entry records), and Durable
    is experimental with breaking changes in minor releases. Every client is tied to
    the daemon's Durable version.
  - Clients need the operation codec. It's small and in Chord, but a non-JavaScript
    client would reimplement it.
  - A renderer that wants "what just changed" diffs states itself.
- **Why the coupling is acceptable:** first-party clients (the TUI now, a web UI
  served by the daemon later) ship in the same package as the daemon, so they always
  match. Only third-party clients need a stable surface, and an adapter can give them
  one (see E).

### B. Durable's agent events (`watchEvents()`)

The server sends a `snapshot` event, then pi-style events (`message_start` /
`message_update` / `message_end`, `tool_execution_*`, `run_start` / `run_end`,
`compaction_*`, `inbox_update`, `usage_changed`).

- **Prior art:** pi's JSON and RPC modes use the same vocabulary. disler/durable-pi
  streams its own frames of this kind ("hello → snapshot → deltas") into a client
  reducer (`AgentModel`) that its web client and TUI share.
- **For:** readable on the wire, natural for incremental rendering ("append this
  text"), close to what pi's own tools and scripts already parse.
- **Against:**
  - Durable marks it "Agent Events (Experimental)".
  - It's about 1.7× larger.
  - Clients still need a reducer to hold state, since events only make sense on top
    of the snapshot.
  - It covers fewer documents than the view, and the task graph is a separate watch
    either way.
- **Best use:** a secondary subscription for simple consumers, such as a
  `pier send … --json` command or scripts. It's cheap to offer next to A, because
  Durable derives both from the same commits.

### C. Chord remote objects, all the way

The daemon runs a Chord host. A conversation is a remote object with a `view` state
member and methods (`send`, `stop`, …), and clients are Chord hosts that `get` it
over a link.

- **Prior art:** Chord's guide sketches exactly this: a `Chat` contract with
  `variant: "participant"` (view, send, stop) or `"viewer"` (view only), served over a
  Durable conversation. Earendil's v1.1.0 server was built on Chord's services, with
  length-prefixed CBOR envelopes over a Unix socket. It was removed in 1.2.0 ("the
  unreleased experimental server, client, and plugin stack"; no reason given).
- **For:** a lot comes built in:
  - principals and variants: an owner, and read-only guests for web or phone sharing
  - flow control: per-link windows and coalescing of slow state
  - pings, and releasing everything a dead link held
  - a protocol-version handshake
  - typed contracts
  - hot reload of daemon code without a restart, which would end the "restarts
    interrupt every pane" problem
- **Against:**
  - It's a large, experimental framework, and its API has already changed: Chord
    1.1 exported `defineService`, and 1.4 replaced it with `remote()` contracts.
  - Clients must be Chord hosts, so JavaScript only in practice; the wire frames are
    specified only by the code.
  - Its links don't resume ("Links do not resume", spec §12). That's fine with
    fresh snapshots, but nothing is gained there either.
  - Earendil built a server on it and withdrew it.
- **Middle path:** A uses Chord's delta codec without its object system. That leaves
  the door open to C if principals or hot reload become worth it.

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
- **Against:** the most design and maintenance, and a reducer on both sides. A buys
  most of the same benefits for first-party clients without the work, and E gives
  third parties a stable surface.

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
| **WebSocket messages, JSON** (recommended) | Framing built in. One codec for the Unix socket (`ws` serves on a socket path), TCP, and browsers. `websocat` debugging. Chord already ships a WebSocket link if C is ever wanted. | A dependency (`ws`), and a handshake on local connections. |

## Option space 3: transport (decision 2)

How a client reaches the daemon, and what stands in for authentication in each case:

| Transport | Reaches | Authentication | Notes |
|---|---|---|---|
| **Unix socket** in `$XDG_RUNTIME_DIR/pier/` | Panes on this host | File permissions (the directory is 0700). The kernel can also report the peer's uid (`SO_PEERCRED`). | Nothing listens on a network. systemd can socket-activate it, starting the daemon on the first connection. Earendil's v1.1.0 stack used exactly this. |
| **SSH** | Terminals on other hosts | Your SSH keys | Two forms: run the client remotely (`ssh <host> pier`, the simplest), or forward the socket (`ssh -L /tmp/pier.sock:/run/user/1000/pier/pier.sock`, supported since OpenSSH 6.7). Adds no new attack surface. |
| **TCP on loopback** | Browsers on this host | A token, plus Origin and Host checks against DNS rebinding and cross-site requests | Browsers can't open Unix sockets, so a web UI needs this. `modules/pi/remote.nix` already does exactly these checks for pi-web and Pi Remote Control. |
| **The tailnet** (bind `tailscale0`, or put `tailscale serve` in front) | Phone and other devices on the tailnet | Tailnet ACLs, plus a token, or Tailscale identity headers (`Tailscale-User-Login`) from `tailscale serve` | **Unchecked:** whether headscale supports `tailscale serve`'s HTTPS certificates and identity headers. Without them it's plain HTTP on the tailnet (WireGuard-encrypted) plus a token, as pi-web is today. |
| **ACP's stdio, through `pier acp`** | Editors | Whoever can run `pier acp` | Not a daemon listener: the adapter itself connects to the Unix socket. |

How they combine:

- **Now:** the Unix socket, and SSH for other hosts.
- **When a web UI exists:** add one HTTP/WebSocket listener, on loopback and the
  tailnet, with authentication decided then.

Because everything is JSON in WebSocket messages, the protocol doesn't change between
them; only the listener and the authentication do.

## Questions for Will

1. **Semantics:** A (Durable's view plus commands; recommended), B (agent events), C
   (Chord remote objects), or F (bespoke)? With A, should B also be offered as a
   secondary stream for scripts?
2. **Envelope:** for A, a minimal pier-owned JSON envelope (requests with ids,
   responses, subscriptions; recommended), or Chord's object system (C) from the
   start?
3. **Framing:** JSON in WebSocket messages everywhere (recommended), or JSON lines
   on the Unix socket and WebSocket only where browsers need it?
4. **Transport for step 2:** the Unix socket only, with SSH for other hosts
   (recommended), deferring the tailnet listener and its authentication to the web
   client?
5. **ACP:** worth a later step (`pier acp`, so Zed and ACP apps can attach)? If
   so, it goes in `todos/poc.md`'s build order after the TUI.

## Sources

- Durable 1.4.0's README ("Watching a Conversation", "Agent Events"), `src/harness/view.ts`
  and `events.ts`, read from nixpkgs' build (see `CLAUDE.md`).
- Chord 1.4.0's README, `docs/guide.md` ("Principals and variants", "References",
  "State", "Hosts and links", "Durable") and `docs/spec.md` §12.
- pi v1.1.0, cloned read-only to `/tmp/pier-research`: `packages/{protocol,server,client}/README.md`
  and `packages/coding-agent/src/experimental/` (`services/README.md`,
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
