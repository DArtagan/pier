# Remote pier: reaching another host's conversations over SSH

## Opening prompt

> **Not ready to build yet.** Will, 2026-11-24: *"I'm going to start by first
> implementing the environment work, and then using that to refresh the remote.md spec
> - before beginning work on it."* So first `todos/environment.md` is built; then this
> spec is refreshed from what was built (component 4 and the hazard in "pier's client
> and protocol" become what the contract does), and only then is this built.
>
> When refreshing: read `docs/vision.md`, `docs/principles.md`, then this file. Will
> has decided the model (remote attach), the transport (SSH, run by each client), and
> the scope (both directions, each host its own conversations, a list across hosts,
> starting conversations on another host, `pier connect` remembering piers, which name
> themselves). Re-check what changed upstream and in p3 since 2026-11-24. Write the
> "Plan", settle what's still open with Will, record his answers here verbatim and
> dated, then build. Keep it thin: this is host code, replaced when p3 takes over.

Written 2026-11-17, from that day's conversation. Will's opening: *"remote control of
pier by other devices. I have a few machines (thenixbeast, steamdeck) and I'll be running
pier on each of them. It would be helpful to connect to the pier sessions of one machine
from the other, over tailnet or lan, to continue sessions remotely."*

## Decided

Will, 2026-11-17:

- **The model is remote attach (A):** a conversation lives, and runs its tools, on the
  host that started it; other hosts watch it and type into it. *"let's go with Model A.
  In the future we may extend it to be Model C, while looking to support more isolated
  run environments."* (C: the conversation stays put, its tools run elsewhere, through
  pi-env.) Hand-off, moving a conversation between hosts (B), wasn't chosen; p3 rejects
  session sync too (its decisions, "Backups, not session sync", 2026-11-09).
- **Both directions:** *"Work will run both ways."*
- **Every host runs its own conversations:** *"Let's have it possible for each machine to
  run their own conversations."* So not one pier for all hosts (model D).
- **sshd on the steamdeck:** *"sshd on the deck is acceptable."*
- **SSH is the transport:** *"We can start with SSH as the transport for now - it's a
  strong protocol and the authentication comes built-in."* No network listener of
  pier's own for this; `todos/web.md`'s listener is a separate piece.
- **Across hosts, and new conversations remotely:** *"Let's show conversations across
  hosts - when we can see multiple hosts. More to the point, I would appreciate the
  ability to start a new conversation on a remote host. Maybe there's a `pier --connect`
  option that has a remote pier "join" and be noted for future sessions."*
- **Usernames stay different:** *"Let's not assume the username unification is soon."*
  `will` on thenixbeast, `willy` on the steamdeck.
- **Naming** (Will, 2026-11-17, to `thenixbeast#3` and `--host`): *"Yes. May optionally
  need to take a username too?"* So a host is remembered with an optional SSH user.
- **Resume:** *"Both `pier resume` and `/resume` should support the same options"*.
- **Network:** *"Both should be possible, but in practice let's go with tailnet only for
  now."*
- **Storage of remembered hosts:** Will asked (2026-11-17) whether Durable suggests a
  place for them (*"uuid, name, hostname, ssh fingerprint - might be two tables"*). See
  Findings, "Where remembered hosts live"; not yet decided. He asked next (2026-11-18)
  whether a host can have several addresses (LAN and tailnet), and how several users on
  one server, each with a pier, would work: see component 2.
- **Version skew** (Will, 2026-11-18): *"Version mismatch: yes, hard refusal. The ssh
  connection recommendation isn't necessary."* So no `ssh -t` hint in the message.
- **Sleeping hosts** (Will, 2026-11-18): *"Yes, sleeping hosts fail fast."*
- **Several addresses** (Will, 2026-11-18): *"Option a."* A list per remote, tried in
  order (component 2, "Several addresses", a).
- **Remotes' record** (Will, 2026-11-18): *"Seems largely right, baring one question:
  will this have a knock-on effect to what we call the conversations, if we've connected
  to multiple remote user instances on the machine? (e.g. thenixbeast#3)"*. See
  component 3.
- **The channel**, asked (Will, 2026-11-18): *"all require us to run an SSH command on
  the local machine to the remote machine, because we've selected handling the
  communications via SSH? It wouldn't be possible for two instances to automatically
  connect to each other once they'd been introduced?"* See component 1, "Who holds the
  connection".
- **Names** (Will, 2026-11-18): *"Yes, option a there sounds good."* Each pier names
  itself (component 3, a).
- **The channel**, asked next (Will, 2026-11-18): *"How much work is involved in securely
  building option iii.?"* See component 1, "What iii would take".
- **The channel** (Will, 2026-11-18): *"Option "i" please."* Each client runs
  `ssh <remote> pier proxy` itself, for the remote it attaches to or lists; the daemons
  never connect to each other. Not ii (the daemon holding links, with a key of its own)
  and not iii (daemons meeting over a listener and pairing of pier's own), for now.
- **Directory and environment** (Will, 2026-11-18): *"We need to have a longer
  conversation about directory and environment next - after we've figured out these
  other details."*
- **Rethinking the whole environment** (Will, 2026-11-24): *"Passing through the pane's
  whole environment might not be the best plan after all. Please research and report on
  some alternative options."* And: *"A good place to start might be by explicitly
  defining what the parts of an "environment" are (e.g. working directory, environment
  variables, etc.). That will form a formal interface contract, and anything not in that
  contract should be isolated away/disallowed. After doing that, we can determine how
  each component in the interface contract is provided."* This reopens his 2026-10-29
  decision (*"keep it simple by passing through the whole environment. We can refine it
  later."*), for local panes too. See `todos/environment.md`.
- **The worktree and PR** (Will, 2026-11-24): *"Please put it in a worktree of its own
  and start pushing that branch to GitHub. And please open a PR, to give me an optional
  interface whereby to review the work."* Branch `remote`, draft PR #22.

## Findings

### The hosts (dotfiles at `5318cfb`, `nix eval`, 2026-11-17)

| | thenixbeast | steamdeck |
|---|---|---|
| User, home | `will`, `/home/will` | `willy`, `/home/willy` |
| pier daemon | `modules/pi/pier.nix`, user service, `WantedBy=default.target` | the same |
| sshd | on, keys only, `openFirewall` (every interface); `will` authorizes `willy@steamdeck`'s key | **off** (`services.openssh.enable = false`) |
| Trusted interfaces | `tailscale0`, `lo` | `tailscale0`, `ap0` (its hotspot), `lo` |
| Linger | off | off |
| Sleep | power button only ("experimenting with keeping the machine online") | suspend, hibernate after 2 h; only the power button wakes it |

- Every host pins the others' host keys (`programs.ssh.knownHosts` in
  `modules/distributed_builders`), as `<host>`, `<host>.forge.local` and LAN addresses
  (thenixbeast 192.168.1.10, steamdeck .12, mini-nas .11). Tailnet names are MagicDNS,
  `*.forge.local`.
- syncthing shares `~/projects` between them (`/home/will/projects`,
  `/home/willy/projects`); `~/repositories` isn't shared.
- `ssh thenixbeast.forge.local` from thenixbeast itself is refused (`will`'s own key
  isn't in its `authorized_keys`); not tried from the steamdeck, which was offline.
- **No linger matters.** The daemon is a user service, started with the user's systemd
  manager. Without linger, that manager stops a few seconds after the user's last
  session closes, taking the daemon and every run with it. So a conversation started
  over SSH on a host where nobody is logged in at the console dies when the SSH session
  ends. Inferred from systemd's documented behaviour, not yet watched happen.

### pier's client and protocol (pier at `main`, 2026-11-17; re-checked at 0.7.0, 2026-11-24)

- The client is one `ws` WebSocket on the Unix socket (`ws+unix://`), with a `hello`
  that checks `PROTOCOL_VERSION` (6 since 0.7.0) for equality. `ws` takes a `createConnection`
  option, so the same client can run over any duplex stream, such as an SSH child's
  stdio.
- `attach` sends the client's `cwd` and its whole environment; the conversation's
  tools run with the environment of the last client that attached. From another host
  both are wrong (`HOME=/home/willy` on thenixbeast).
- The client reconnects by itself and resumes its transcript with only what it missed
  (`ConversationTranscript`), so a suspended steamdeck coming back needs nothing new.
- What the client reads locally: pi's `settings.json` (theme etc.), `HOME` to shorten
  the footer's directory, the clipboard for images. `@file` completion is off (no `fd`).
  The model list and credentials are the daemon's: each host needs its own
  `claude auth login`.

### Where remembered hosts live (Durable 1.5.2's README and `docs/spec.md` §3, 2026-11-17)

- **Durable's place for an app's own state is a document** (`defineDoc`, README "Your
  Own State"): typed JSON, versioned with `migrate`, committed atomically, watchable
  (`harness.watchDoc()`), and backed up with the SQLite file. A document's `scope` is
  `session` (the whole storage), `conversation` or `task`. pier already keeps
  `pier.numbers` as a session document, and `docs/principles.md` (section 2) says pier's
  state goes in Durable documents.
- **Durable has no tables for apps.** SQLite storage can share its database with host
  tables (`prefix`), but that's for Cloudflare's adapter, and goes around Durable.
- **A document family** (`defineDocFamily`, spec §3.1) is the nearest thing to a table:
  one document per key, created and retired one at a time.
- **Identifiers**: Durable's ids are numbers from one shared counter, never shown;
  `pi.provider` mints a UUIDv7 with pi-ai's `uuidv7()`, the precedent for an id of pier's.
- **The host key** has a store already: OpenSSH's `known_hosts`. pi-env (1.5.2,
  `src/ssh.ts`) keeps a `known_hosts` of its own, checks with
  `StrictHostKeyChecking=yes` and a `HostKeyAlias` per environment, and accepts a key only
  after showing its fingerprint (`scanHostKey`, `acceptHostKey`). p2 does the same
  (`plugins/envs/config.ts`). p3 keeps a fact in one place only (decisions, 2026-11-09).
- **Will's hosts already pin each other's keys** in the system `known_hosts`
  (`programs.ssh.knownHosts`), so plain `ssh` verifies them with nothing of pier's.
- **The daemon owns the storage, not the client.** Only the daemon opens the SQLite
  file, so the client reads and writes remembered hosts through protocol methods. p3's
  view (slice 8, "an SSH machine's key stays on the server: it holds the connection")
  points the same way for model C, where the daemon itself connects to hosts.

### Prior art

- **p3**: one instance per person, other machines as environments (slice 8, pi-env over
  SSH), new devices by pairing codes, remote access through Radius or a tunnel (slice 21,
  an empty brief at `cead615`, 2026-11-17). p2's remote environments
  (`apps/p2/docs/remote-envs.md`) name a location `env:/path`, never fall back to the
  local machine, and keep SSH keys and the connection on the server.
- **Zed and VS Code remote development** run a small server on the far host, started over
  SSH, with the UI local; Zed's speaks over the SSH child's stdio.
- **`remote.nix`** (pi-web, Pi Remote Control) runs browser UIs on the tailnet for
  classic pi, guarded by the firewall and Host and Origin checks.

## Components, options and proposals

Proposals are Claude's, until Will agrees.

1. **The channel.** How a local client reaches a far daemon's socket. Every option but
   e runs the system's `ssh`, so `~/.ssh/config`, the agent, `known_hosts` and
   `ProxyJump` work with no code of pier's.
   - a. **`ssh <remote> pier proxy`** (proposal): a hidden command on the far host that
     pipes stdio to its own user's daemon socket, which it finds as `pier` does. The
     client speaks WebSocket over the SSH child's stdio (`ws`'s `createConnection`). It
     fails plainly when pier isn't installed there, needs no path from the client, and
     is where the far side could add facts of its own (its environment; see the
     directory and environment conversation). The proxy only copies bytes, so a proxy
     from a newer package than the running daemon (`keep-old`) is harmless; `hello`
     still checks the daemon.
   - b. **A forwarded socket**, `ssh -L <local.sock>:<far socket>` (OpenSSH ≥ 6.7;
     thenixbeast's sshd leaves `AllowStreamLocalForwarding` at its default, yes). Needs
     the far socket's path (`/run/user/<uid>/pier/pier.sock`, so a first command to learn
     it), leaves a socket file per connection to clean up, and the far side can add
     nothing. Its advantage: nothing of pier's runs on the far host, so any pier with
     the same protocol answers.
   - c. **A generic bridge**, `ssh <remote> socat STDIO UNIX-CONNECT:<path>` (or
     `nc -U`): a, without pier's own command, but needing socat on the far host and the
     path, as b does.
   - d. **`ssh -t <remote> pier`**: the far host's client draws, in a terminal over
     SSH. Works now (for thenixbeast), needs nothing built, but the deck's sleep ends
     the session, tmux nests, and lists across hosts are impossible.
   - e. **SSH in Node** (the `ssh2` package): no `ssh` child, but its own config,
     `known_hosts` and agent handling, which would ignore Nix's pinned keys and
     `~/.ssh/config`; a dependency against principle 4. Not proposed.
   - f. **pi-env's connection**: it deploys its own Rust daemon over SSH for tools, not
     for clients. It's the channel for model C, not this.

   **Who holds the connection** (Will's question, 2026-11-18). In every option above,
   pier runs `ssh` itself; nobody types it. What differs is which process does:
   - **i. Each client** (as above): `pier` in a pane spawns `ssh` for the remote it
     attaches to. The daemons never meet; nothing runs while no pane is attached.
   - **ii. The daemons, over SSH** ("introduced, then connected"): `pier connect` tells
     the local daemon about a remote, and the daemon holds the link from then on,
     connecting on demand and reconnecting by itself. Clients only ever talk to their
     local daemon, which relays the remote's lists and watches (opaque bytes; both
     ends' versions match, by the hard refusal). It's p3's and pi-env's shape ("an SSH
     machine's key stays on the server: it holds the connection", p3 slice 8), so it
     leads to model C, and later to notifications from other hosts. Costs: relaying in
     the daemon, and a restart of either daemon drops the links. The daemon needs an
     SSH identity that works with nobody logged in. Today's key is in the GNOME
     keyring's agent (`SSH_AUTH_SOCK=/run/user/1001/gcr/ssh`, which the user service
     inherits; checked 2026-11-18), which is there only while a desktop session is. The
     dotfiles' precedent is a key of its own: `modules/distributed_builders` gives the
     `nix` user a sops key, authorized as
     `restrict,command="…nix-daemon --stdio"`. pier's would be
     `restrict,command="pier proxy"`: a key that can do nothing but reach pier.
   - **iii. The daemons, directly** (no SSH): each daemon listens on the tailnet, and an
     introduction exchanges keys or a token, as p3's pairing codes do, or relies on
     Tailscale's identity of the peer (`tailscale whois`). A listener and a sign-in of
     pier's own, which Will deferred ("SSH as the transport for now"); `todos/web.md`'s
     listener would be its natural home.

   **What iii would take** (Will's question, 2026-11-18). Checked that day: `tailscale
   whois` works on headscale, but names every device's user as `will`, the iPhone and
   both JetKVMs included; `tailscale0` is a trusted interface, so a port bound there is
   open to every device on the tailnet; Node 24 signs and verifies Ed25519, but can't
   make an X.509 certificate. A listener here is a remote shell (the agent runs bash), so
   a flaw is code execution on the host from any tailnet device. What it needs:
   - **The listener:** bound to the host's tailnet address only (not `::`, which the
     trusted interface would leave open to the LAN, or to the hotspot on the deck),
     with a cap on connections and frame size, and a short deadline before sign-in.
   - **Identity:** an Ed25519 key per pier, in a private file (not the SQLite file,
     which is backed up), its public half in `pier.instance`.
   - **Introduction:** a pairing code, as p3 chose: shown on one pier, typed on the
     other, single use, expiring in minutes, rate-limited. Over WireGuard a simple
     challenge with the code suffices; over the LAN it would need a PAKE (CPace,
     SPAKE2), which Node doesn't have, or TLS, for which it can't make the certificate.
   - **Sign-in on every connection:** both sides sign the other's fresh nonce, before any
     other message; tailnet address of the remembered peer checked as well. `whois`
     alone isn't enough: every device on the tailnet is `will`.
   - **Browsers:** a page on the tailnet can open a WebSocket to the port, so Origin and
     Host checks, and nothing done before the signed handshake.
   - **Revocation:** `pier forget` on either side, closing its live links.
   - **The relay** of ii (daemons pass lists and watches through), unless clients
     connect to the remote's listener themselves with their pier's key.
   - **Tests that can fail:** refusing a wrong key, a replayed signature, an expired or
     reused code, a guessed code past the limit, a page's Origin; and a review of the
     handshake.
   - **Principles:** sign-in is on the list of p3's core that pier doesn't build
     (section 1), except what the web UI needs. iii fits that exception only if it's the
     web UI's sign-in too, which it can't quite be: browsers have no WebCrypto over plain
     HTTP (only on secure origins), so a phone would sign in with a cookie from the
     same pairing, not a key.

   Estimate (Claude's, not measured): 1,000–1,500 lines with tests, against about
   3,300 in `src/host/` now; i is perhaps 200–300, ii 400–600 plus a sops key in
   dotfiles. The cost is less the lines than owning a security boundary SSH provides
   already.

   Decided: i. Write it so the piece that opens the channel could move into the daemon
   (ii) without changing the protocol, if something later needs a link while no pane is
   attached (notifications, model C).

   For any of them: reconnecting starts a new `ssh`. Fail fast (decided): `BatchMode=yes`
   once a remote is known, `ConnectTimeout` of a few seconds, and `ServerAliveInterval`
   so a suspended far end shows as the child exiting. `ControlMaster` with a
   `ControlPath` in pier's runtime directory makes a list across remotes, then an
   attach, one SSH handshake per remote. Unverified: whether a non-interactive SSH
   command finds `pier` on the PATH under NixOS (`ssh thenixbeast` to itself is
   refused, and the deck was offline).
2. **Remembering remotes: `pier connect`.** `pier connect [user@]address [--name n]`
   checks the remote (SSH, `pier proxy`, `hello`) and records it.
   - **What's remembered is a pier, not a machine.** A daemon belongs to one user on one
     machine (a user service, a socket in that user's runtime directory, a SQLite file in
     that user's state directory), and SSH as a user reaches only that user's daemon.
     So the record is a *remote*: one pier, reached as one user, at one or more
     addresses. Calling it a host would mislead in both cases below.
   - **Each daemon gets an id of its own:** a session document `pier.instance`,
     `{ id: uuidv7() }`, written once, and sent in `hello`. A remote records the id it
     saw, so a reinstalled or different pier at the same address is noticed, rather
     than `thenixbeast#3` silently meaning another conversation. The id is also what
     ties several addresses together: whichever answers, it must be the same pier.
   - **Proposal: a session document family `pier.remotes`**, one document per remote,
     keyed by its name:
     `{ name, user?, addresses: [{ address, port? }], instance, added }`. A family
     rather than one document holding a map, because remotes come and go one at a time.
     Read and written through new protocol methods (`remotes`, `connect`, `forget`).
   - **Several addresses for one machine** (Will's question, 2026-11-18). Options:
     - a. **a list in the record, tried in order** (proposal): `pier connect` adds an
       address to an existing remote when the instance id matches (or with
       `--name thenixbeast`); connecting tries each with the short `ConnectTimeout`,
       first that answers wins, and the instance id is checked on every one. Tailnet
       first, as decided.
     - b. **one address, and SSH picks the route**: the record names an `ssh_config`
       host, and `~/.ssh/config` chooses, e.g. `Match host thenixbeast exec "…on the
       LAN…"` setting `Hostname 192.168.1.10`. pier stays simpler, but the choice is
       hidden in SSH's config, and a failed route isn't retried on the other.
     - c. **several remotes**, one per address. Simplest, but `thenixbeast#3` and
       `thenixbeast-lan#3` would be the same conversation under two names.

     The host key is the same on every address, and Will's `known_hosts` already pins
     each machine's key under its name, its `.forge.local` name and its LAN address. A
     new address needs its key accepted once, or `HostKeyAlias=<name>` so every address
     is checked against one entry. In practice it's one address now (tailnet only).
   - **Several users on one server, each with a pier** (Will's question, 2026-11-18):
     each is a remote of its own, `alice@nas` and `bob@nas`: same address, different
     user, different daemon, storage and instance id, and different names
     (`nas#3` and `nas-bob#3`; `pier connect` refuses a name in use). Nothing is shared
     between them: SSH's login decides whose pier answers, and file permissions keep
     each socket to its user, as now. Each needs linger for its daemon to outlive the
     login. Two users on one machine each running a daemon is already how pier works
     locally; nothing new is needed for it. It matches p3, one Pi per person.
   - **The second table is OpenSSH's.** The host key stays in `known_hosts`, the one
     store OpenSSH checks, and isn't copied into the document. Options:
     - a. the user's `known_hosts` and the system's, as plain `ssh` uses (Will's are pinned
       by Nix already); `pier connect` lets `ssh` ask about a new key at the terminal;
     - b. a `known_hosts` of pier's, as pi-env and p2 keep, with `HostKeyAlias=pier-<name>`
       and `StrictHostKeyChecking=yes`; `pier connect` shows the fingerprint and asks.

     Proposal: a, since b would ignore the keys Nix already pins. b is the one to take up
     with model C, when the daemon connects through pi-env, which takes exactly those
     options.
   - Alternatives weighed: a client file (`~/.config/pier/hosts.json`) needs no protocol
     method and works with no daemon, but is a second store, and the vision expects the
     daemon to own hosts once they're environments too; a Nix list is declarative, but
     `pier connect` couldn't add to it.
   - Each host's list is its own; joining thenixbeast from the deck doesn't add the deck
     to thenixbeast's list, since that direction needs its own SSH key and sshd.
3. **Naming** (decided). The local host stays `#3`; another host's conversation is
   `thenixbeast#3`, in `pier resume thenixbeast#3`, `/resume` and lists. New ones with
   `pier new --host thenixbeast`. The name is the remote's; its addresses and user
   (`willy@steamdeck.forge.local`) are what `ssh` gets. Conversation numbers are per
   pier already.

   With several piers on one machine (Will's question, 2026-11-18), the part before `#`
   names a pier, not a machine, so it must differ: `thenixbeast#3` and
   `bob@thenixbeast#3`. Options for where names come from:
   - a. **each pier names itself** (proposal): a name in `pier.instance`, by default the
     machine's short host name, sent in `hello`. `pier connect` takes it, so
     `thenixbeast#3` means the same conversation on every machine, and the local pier
     answers to its own name too (`thenixbeast#3` works on thenixbeast). A second pier
     on a machine whose name is taken is offered `user@host`; a local `--name` overrides
     on a clash.
   - b. **the connecting side names it**: `pier connect` defaults to the host part of the
     address, and to `user@host` when that's taken. Simpler, but one conversation can
     have different names on different machines.

   Either way, `@` is allowed in a name, so `user@host#3` reads as SSH does.
4. **Directory and environment for a remote client.** The longer conversation, started
   2026-11-18. Facts first (pier at `main` and Durable 1.5.2's `env/node.ts`, that day):
   - **Today both come from the pane.** `attach` sends the client's `cwd` (used only when
     it creates a conversation) and its whole environment, which replaces the
     conversation's `pier.client-env` on every attach (Will, 2026-10-29: *"keep it simple
     by passing through the whole environment. We can refine it later."*). Durable
     builds each tool call's environment from it, laid over the daemon's own
     (`NodeExecutionEnv`'s `shellEnv` over `process.env`), so a variable the pane lacks
     falls back to the service's.
   - **The service's environment** is systemd's user manager's plus the unit's: `HOME`,
     a profile `PATH`, the GNOME keyring's `SSH_AUTH_SOCK`, `DISPLAY`, `WAYLAND_DISPLAY`;
     no devenv. Checked on thenixbeast's running daemon.
   - **A remote pane's environment is meaningless on the far host:** its `HOME`, store
     paths, devenv `PATH`, `SSH_AUTH_SOCK`, `TMUX` and `DISPLAY` are the near host's.
     And it would carry whatever secrets the pane holds to another machine.
   - **The far side does see an environment:** `pier proxy` runs in a non-interactive SSH
     session there, which has that user's `HOME` and login `PATH`, and no display or
     agent unless forwarded. Not verified on these hosts.
   - **devenv comes from direnv**, enabled for both users (`home.nix`). Its allow-list is
     per user and host (`~/.local/share/direnv/allow`, 113 entries on thenixbeast), so a
     project allowed on the deck isn't on thenixbeast until allowed there.
   - **The daemon doesn't check a directory exists** when it creates a conversation; a
     wrong one surfaces as tool errors. AGENTS.md and skills are read on the daemon's
     host from the conversation's directory, so they're right once the directory is.
   - **The footer shortens the directory with the client's `HOME`**, which is wrong for
     another host's: the remote's home must come with `hello`.

   **The directory** of a conversation started remotely (`pier new --host`, and `pier`
   continuing the newest one "here"):
   - a. the far home, always;
   - b. **the same path relative to home**: the deck's `~/projects/x` is `~/projects/x`
     on thenixbeast. Right for syncthing's `~/projects`, meaningless elsewhere;
   - c. **an explicit `--cwd`**, a far path, absolute or `~/…` (the far home);
   - d. **a menu of the remote's directories**, those its conversations used, newest
     first: p2's "recent directories scoped to the selected machine". For `/new` in the
     TUI, and `pier new --host` with no `--cwd`.

   Whatever is chosen, the far daemon checks it exists and refuses otherwise, never
   falling back to home (p2: never fall back).

   **The environment**, where a conversation's tools get theirs:
   - a. **remote attaches send none**: the conversation keeps the environment of the
     last local pane; one started remotely has only the service's (no devenv);
   - b. **the far SSH session's**, which `pier proxy` sends instead of the pane's: right
     `HOME` and `PATH`, still no devenv;
   - c. **b plus direnv**: `direnv export json` in the conversation's directory on the far
     host, so devenv's tools are there, as in a local pane. Needs the project allowed on
     that host; a slow first evaluation (nix-direnv builds the shell) delays the attach;
   - d. **the environment belongs to the place, not the pane**: the daemon builds it from
     its own (service) environment plus direnv in the conversation's directory, for
     every conversation, local or remote; panes send nothing. The same on every host
     and after any attach, and it's p3's model (a session's location decides its
     environment, slice 8) and the shape model C needs. But it changes the 2026-10-29
     decision for local panes too: a pane's `SSH_AUTH_SOCK`, an exported token or a
     `nix shell` no longer reach the tools.

   And **which attaches change it**: every attach (today), only the one that creates a
   conversation, or only local ones.

   Superseded as a question by Will's request of 2026-11-24: the environment is defined
   as a contract first, then each part's source is chosen, for local and remote
   conversations alike. That's `todos/environment.md`, which this spec waits on. The
   directory stays here.
5. **Version skew** (decided: hard refusal). Hosts switch separately, and `keep-old`
   leaves a daemon on its old version. The equality check stays; the refusal names both
   sides' pier versions (added to `hello`), and nothing more. Compatibility across
   versions isn't worth building: Durable's view changes shape with it.
6. **Listing across hosts.** `pier list` asks every remembered host in parallel, with a
   short timeout, and shows an unreachable one as such. `pier resume` and `/resume` take
   the same targets (decided): `#3`, `thenixbeast#3`, and the same menu. So the TUI must
   switch its connection between hosts, which it does now only to reconnect.
7. **Hosts' setup (dotfiles).** sshd on the deck; `will@thenixbeast`'s key in `willy`'s
   `authorized_keys`; linger on both (Findings). Tailnet only for now (decided):
   `openFirewall = false` on both, since `tailscale0` is trusted; remembered addresses
   are `*.forge.local`. The LAN stays possible by address.
8. **Towards C.** Keep "which host" and "where tools run" separate in names and code: a
   remembered host may later also be an environment (pi-env over the same SSH), which
   is p3's slice 8 and belongs in `src/layer/`.

## Open questions for Will

1. The environment: `todos/environment.md`'s questions, first.
2. The directory of a conversation started remotely: `--cwd` and a menu of the
   remote's recent directories, with or without mapping relative to home (component 4)?

## Plan

To be settled once the open questions are answered. Roughly: hosts' setup in dotfiles
(7); `pier proxy` and the client over SSH (1); `pier connect` and naming (2, 3); the
directory and environment (4); version messages (5); listing (6).

## Done when

From either host, `pier` can list both hosts' conversations, attach to and continue one
on the other, and start one there, with its tools running in the right directory and
environment on that host. Then the setup goes in `README.md` and this file is deleted.
