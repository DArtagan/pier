# Credentials: principles first, then a design

## Opening prompt

> Read `docs/principles.md`, `todos/environment.md` (the contract's Credentials group),
> then `todos/credentials.md`. Will asked for the
> principles of a credentials system before its design. Put the principles below to him
> one by one, and record what he keeps, changes or drops, verbatim and dated. Don't
> design the implementation until he's settled them. Then take "Design questions" in
> order.

Written 2026-11-24, at Will's request: *"What matters more then is designing a good
"Credentials" system such that a project's sensitive values previously stored in the
`.env` file can be later migrated to the "Credentials" system - allowing stronger access
controls. In this conceiving, one should define the principles behind the Credentials
system before then designing the implementation."*

It follows from his axiom of the same day (`todos/environment.md`, "Decided"): a
conversation pointed at a project may see that project's `.env`. That's the floor. This
system is how a project, or Will's own credentials, get more control than that.

Everything below is Claude's proposal until Will agrees, except what's marked decided.

## Decided already

- **Tiers** (Will, 2026-11-24: *"I like your tiers"*), proposed in
  `todos/environment.evidence.md` ("Credentials, in tiers"):
  0 none; 1 project and tools; 2 infrastructure (SSH to other machines); 3 root on this
  machine.
- **A GitHub token made for agents** (Will, 2026-11-24: *"Yes to a `GitHub` token made
  for agents."*).
- **Which machines and users an agent's SSH key reaches** waits for implementation
  (Will, 2026-11-24).
- **On the first draft** (Will, 2026-11-24): *""use without exposure" is a great
  principle. A solid start with the accepted caveat that a sandbox is the only thing
  that provides real isolation. No store preferences yet."* And: *"Otherwise the
  todos/credentials.md spec is a good start."* He asked what principle 5 means (below).
  Principle 6 is kept, with principle 11's caveat; no store is ruled in or out.
- **Principles 5 and 7** (Will, 2026-11-24, on the explanation of 5 and on 7): *"Yes on
  both accounts, well done."* The decision moves closer to the moment of use as the tier
  rises; values are never stored in pier's SQLite file.
- **A project's `.env` passes to conversations in that project** (Will's axiom,
  2026-11-24).
- **An allowlist**, never a denylist, for what reaches a tool (Will, 2026-11-24).

## What exists today (checked 2026-11-24, thenixbeast)

| Credential | Where it lives | Who can use it |
|---|---|---|
| Will's SSH key | `~/.ssh/id_ed25519`, from sops, passphrase-protected; unlocked into an agent (the GNOME keyring's, or `ssh-agent` per terminal) | any process of Will's that reaches an unlocked agent's socket |
| GitHub, for `gh` | `~/.config/gh/hosts.yml` | any process of Will's |
| A project's API tokens | the project's `.env`, gitignored (vulcanus-proxmox: Proxmox, Gmail, Terraform's GitHub token, Pushover) | anything in a shell in that project (direnv) |
| Kubernetes, Talos | files in the project (`.kubeconfig`, `.talosconfig`, 0700) | any process of Will's |
| Secrets in a repository | SOPS-encrypted files, decrypted by Will's age or SSH key | whoever holds a key in `.sops.yaml` |
| Host and service secrets | sops-nix, in dotfiles, per host | the service they're declared for |
| Will's tools (Todoist, Calendar, ketch's backends) | their config files in `~/.config` | any process of Will's |
| Root | `sudo` with Will's password (`wheelNeedsPassword`); polkit's `run0` | Will, interactively |
| 1Password | the desktop app; `op` 2.42.0 installed; its SSH agent not switched on (`todos/ssh-agent.md` in dotfiles) | Will, interactively |

Today, a pier tool runs as Will, so in practice it holds everything in the last column
that doesn't need a password typed.

## Prior art (read 2026-11-24)

- **p2's sandbox secrets** (`apps/p2/plugins/envs/secrets.ts`, `secret-presets.ts`,
  `docs/remote-envs.md`): a secret has a name, a value, and the hosts it may be sent to.
  The VM sees only a *placeholder*; the sandbox's HTTP proxy replaces it with the value
  in requests to those hosts. Presets add aliases (`GH_TOKEN` for `GITHUB_TOKEN`) and a
  git credential helper. Values are stored in a private file, never shown to the
  browser, and reach the launcher only on stdin. The owner sees names, hosts and age.
- **p3's open items** (`slices/07-models.md`, at `d476013`): "Credentials by reference,
  never copied", with delivery kinds `pushed` (with an expiry), `signing` (an ssh-agent
  bridged, the key stays on the server) and `server-only`. Workers get only their
  session's providers' tokens, and the server refreshes them.
- **Claude Code's subprocess scrub** and **Codex's environment policy**
  (`todos/environment.evidence.md`, "Prior art"): both filter variables by name; both say this isn't
  a boundary.
- **OpenSSH's agent** can constrain a key: a lifetime (`ssh-add -t`), the hosts it may be
  used for (`ssh-add -h`, 8.9 and later), and confirmation before each use (`ssh-add -c`,
  with an askpass program).
- **sops-nix and systemd credentials** (`systemd-creds`, `LoadCredential=`): secrets as
  files given to one service, readable only by it, never in its environment.

## Related art, to evaluate

Gathered by Will on 2026-11-25, for future evaluation. Each note below is from its own
README or site, read 2026-11-25 (Boundary from its docs: the product page answered
HTTP 429); nothing was installed or tried, and none of it is evaluated yet. The pages
are tagged `credentials-art` in ketch (`ketch tag show credentials-art`). Grouped by
the principle or design question each bears on most; several span groups, and the
notes say where.

What they share: the commercial ones have all moved, by late 2026, into credentials
for AI agents (brokering, placeholders, just-in-time grants), so "use without
exposure" (principle 6) is now a product category, not only p2's idea.

- **Secret stores, and handing values to tools** (design questions 1 and 2;
  principles 1, 7 and 12):
  - [SecretSpec](https://secretspec.dev/) (added by Will, 2026-11-25): Cachix's, from
    the devenv authors, and built into devenv. A project declares the secrets it needs
    in `secretspec.toml` (names, descriptions, required or not, profiles); where each
    value lives is chosen per user or per secret, from about 35 providers, among them
    the keyring, `.env`, 1Password, SOPS, age, systemd credentials, Infisical and
    Tailscale's [Setec](https://github.com/tailscale/setec). `secretspec run` gives a
    command only its declared secrets, or a scope's subset (its docs: scopes "are not
    an authorization boundary"); `as_path` gives a file instead of a value;
    `secretspec init --from dotenv` and `import dotenv://.env` migrate a `.env`. 0.21
    (2026-09-22) added a JSON-RPC protocol (`secretspec serve`) for a tool to ask a
    resolver for one secret at a time, over stdio or SSH, and one for external
    providers, which can return approval references for a local audit log. Checked on
    thenixbeast 2026-11-25: `secretspec` 0.21.0 is installed, devenv is 2.4.0, nearly
    every project in `~/repositories` has a `devenv.nix`, and reelbarrow already uses
    SecretSpec (keyring provider, secrets given only through `secretspec run`, devenv's
    loading off).
  - [SOPS](https://github.com/getsops/sops): an editor of encrypted files (YAML, JSON,
    ENV, INI, binary), with age, PGP or a cloud KMS; a CNCF sandbox project. Already in
    use (dotfiles, vulcanus-proxmox); see "What exists today".
  - [1Password](https://1password.com/): already installed ("What exists today").
    Secret references (`op://vault/item/[section/]field`) resolved by `op read`,
    `op run` (as variables, to one subprocess) or `op inject` (into a config file):
    principle 1's "by reference". Service accounts restrict the CLI to some vaults
    (principle 4); "Environments" (beta) pass a project's variables without
    references, close to a `.env` migration (principle 10). An Environment can be
    [mounted as a project's `.env`](https://www.1password.dev/environments/local-env-file)
    (Linux and Mac): a named pipe, nothing on disk, and the first read prompts for
    approval, but once approved *every* process can read it until 1Password locks, so
    it doesn't tell pier's tools from Will's shell. Newer: a Credential
    Broker (public preview, Enterprise) that verifies a workload by OIDC and logs each
    delivery, starting with GitHub Actions; and "Privileged Access", just-in-time.
  - [Infisical](https://github.com/infisical/infisical): open source, self-hostable or
    cloud; now a platform for secrets, certificates, privileged access (PAM) and
    agents' access. Secrets: `infisical run -- <cmd>` injects them as variables, an
    agent daemon renders them into files, plus rotation, dynamic (short-lived) secrets
    and honey tokens. Its PAM for AI agents
    ([docs](https://infisical.com/docs/documentation/platform/pam/ai-agents/overview))
    belongs under the next group too: `infisical pam access <account> -- <cmd>` opens a
    recorded session through a gateway that adds the credential, so it never reaches
    the agent's machine.
  - [Stacklok](https://stacklok.com/): an enterprise MCP platform (registry, gateway,
    Kubernetes runtime). Its open-source [ToolHive](https://github.com/stacklok/toolhive)
    runs each MCP server in a container, with
    [secrets](https://docs.stacklok.com/toolhive/guides-cli/secrets-management) from
    one provider: its own encrypted store (the password in the OS keyring), 1Password
    (read-only, by `op://` reference) or environment variables. Relevant only if pier's
    tools come to include MCP servers.
- **Use without exposure, for agents** (principle 6; p2's placeholders; tier 3):
  - [Infisical's agent-vault](https://github.com/Infisical/agent-vault): an HTTP
    credential proxy. The agent's environment gets `HTTPS_PROXY`; the proxy intercepts
    (MITM) and swaps dummy values in headers for real credentials, or replaces the auth
    header, per service; egress filtering (an unknown host denied in strict mode) and
    request logs. The same shape as p2's placeholders. **The standalone repository is
    no longer recommended**: Infisical points new setups at Agent Vault inside
    Infisical (access bundles, time-bound sessions).
  - [HashiCorp Boundary](https://developer.hashicorp.com/boundary/docs/overview/what-is-boundary):
    identity-based access to hosts, databases and applications through a proxy that
    injects credentials, so users connect with their usual clients and never hold them;
    short-lived credentials from HashiCorp Vault; sessions recorded; just-in-time
    access. Server editions are HCP (hosted) and Enterprise; Formal's comparison says
    there's a Community Edition too (not checked). Heavyweight for one person.
  - [lockfamily](https://github.com/DavidGodefroid/lockfamily): Will: *"probably too
    young to matter, but is interesting"*. Every tool is before v1. Each data source
    (databases, queues, files, logs, servers; `lockhttp` and `lockssh` pre-release)
    sits behind a "Lock" that holds the credential and masks personal data in results;
    reads pass by rule, while a write or a connection waits for approval in `lox run`,
    a terminal outside the agent's harness, and `lox audit` logs both. Runs in Docker.
    Its README says the guarantees hold against a prompt-injected agent only when the
    agent runs confined (in its `lea`). Closest of the list to principle 5's tier 3
    (approve the exact command, outside the agent) and to principle 11's caveat.
  - [Formal](https://www.formal.ai): two proxies under one control plane (policies in
    Rego, one audit log). "Endpoint" is a forward proxy on laptops, VMs and agent
    sandboxes: egress control, API keys held at the proxy rather than in the sandbox.
    "Connector" is a reverse proxy in front of databases, Kubernetes, SSH and MCP
    servers, applying policy per query or command, with sessions recorded. No vault.
    Commercial. Its [comparison of PAM tools](https://www.formal.ai/compare/best-pam-solutions/)
    (its own, updated 2026-11-10) covers ten: BeyondTrust, CyberArk, Delinea (with
    StrongDM), Formal, Boundary, KeeperPAM, ManageEngine PAM360, Netwrix, Okta
    Privileged Access and Teleport; it names Segura, WALLIX, Securden, One Identity
    Safeguard, ARCON, Devolutions and Entra PIM as unread. Mostly enterprise PAM.
- **SSH and infrastructure access: bastions, short-lived certificates, recorded
  sessions** (tier 2; principles 4, 5 and 8):
  - [The Bastion](https://github.com/ovh/the-bastion) (OVH): an SSH bastion, the single
    entry point to servers. Each user has an account and joins groups that reach some
    infrastructure, which trusts the groups' keys rather than each user; sessions
    recorded (ttyrec, interactive and not); MFA; a JSON API over SSH; plain `ssh` at
    both ends, no database.
  - [BLESS](https://github.com/Netflix/bless) (Netflix): an SSH certificate authority,
    as an AWS Lambda, that signs short-lived certificates so hosts trust a CA instead
    of `authorized_keys`. **Archived**: Netflix no longer maintains it. The idea (a
    short-lived certificate per grant) is what matters for tier 2, not the code.
  - [Teleport](https://github.com/gravitational/teleport): an identity-aware proxy
    and a CA issuing short-lived certificates in place of SSH keys or Kubernetes
    tokens, for SSH, Kubernetes, databases, RDP, web apps, Git and MCP servers; MFA,
    SSO, sessions recorded, just-in-time access requests. One Go binary; a Community
    Edition with public code (its license terms not checked).
  - [Warpgate](https://github.com/warp-tech/warpgate): a transparent bastion for SSH,
    HTTPS, Kubernetes, MySQL, PostgreSQL, RDP and VNC that needs no client software;
    users assigned to hosts, every session recorded and replayable in a web UI, TOTP
    and OpenID Connect, "tickets" as temporary access credentials. One Rust binary,
    self-hosted.
- **Network access** (design question 5, `todos/remote.md`), several now with PAM
  features that bear on tier 2:
  - [Tailscale](https://tailscale.com): the tailnet pier's remote access already
    weighs. [Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh.md) takes port
    22 on the tailnet and authorizes by its access rules instead of SSH keys; check
    mode makes some connections (as root, say) re-authenticate, then holds for 12
    hours or a set period; sessions can be recorded. Check mode is principle 5's
    "closer attention" for tier 2, already built.
  - [Twingate](https://www.twingate.com/): zero-trust network access, per resource,
    not per network; its own proxy, not WireGuard; a hosted controller with connectors
    you run. Now also PAM: short-lived, audited access in place of static SSH keys and
    kubeconfigs. A Home plan for non-commercial homelabs.
  - [Pangolin](https://github.com/fosrl/pangolin): open source, on WireGuard; access by
    identity to web apps, SSH, remote desktops, databases and AI models, each grant
    logged, from a browser or a client. Self-hosted Community Edition, or a cloud. Has
    an identity-aware gateway for AI agents' model traffic.

## Principles, proposed

Each with why. The design must keep all of them, or say which it bends and why.

1. **A credential is a named thing, not a value scattered around.** It has a name, a
   kind (token, SSH key, password, file), a tier, an owner, and where its value lives.
   Conversations and configuration refer to it by name; the value is in one place.
   *Why:* p3's "by reference, never copied". A value copied into many places can't be
   rotated or revoked in one.

2. **Least privilege, by default none.** A conversation gets no credential unless one
   is granted to it, or to the project it's in. Tier 0 is the default. *Why:* the
   allowlist principle Will chose for variables, applied to what matters most.

3. **Grants are explicit, visible and revocable.** Every grant says which credential,
   to what (a project, a conversation), and why it exists. Will can list them all, and
   take one back without touching the others. *Why:* access Will can't see is access he
   can't reason about.

4. **Narrow credentials over broad ones.** Prefer a credential made for agents, scoped
   to what they do (a fine-grained GitHub token for some repositories, an SSH key that
   only some machines accept), over Will's own. Will's own credentials don't reach tools
   by default. *Why:* a leaked narrow credential is a small incident; a leaked broad one
   is a large one. Decided already for GitHub.

5. **The higher the tier, the closer Will's attention.** Tier 1 may be standing grants;
   tier 2 grants are per project or per conversation, and narrow; tier 3 is never
   standing: it's asked for each time, or Will does it himself. *Why:* the tiers exist
   because the damage differs.

   *What it means* (Will asked, 2026-11-24). "Attention" is how often, and how recently,
   Will must have looked at a use of a credential before it happens. The worse a misuse
   could be, the closer to the moment of use his decision should be:

   | Tier | Worst misuse | When Will decides | How, for example |
   |---|---|---|---|
   | 0 | none | never | nothing to grant |
   | 1, project and tools | a project's API tokens or a narrow GitHub token used wrongly: recoverable, one project | once, ahead of time | a standing grant in the YAML config, reviewed like code; the project's `.env` (the axiom) |
   | 2, infrastructure | SSH into vulcanus or the NAS as root: other machines changed | per project or per conversation, when work there starts | `/grant ssh vulcanus` in the TUI, ending with the conversation or after hours; a key that only some machines accept |
   | 3, root here | this machine reconfigured, a backdoor installed | each time, at the moment of use | the tool waits until Will approves the exact command in the TUI (Durable's tools that park), or Will runs it himself |

   So the further down the table, the shorter a grant lives and the more specific it is:
   standing, then per session, then per command. It's the same rule `sudo` follows when
   it asks again after a timeout, and Will's own rule for his SSH agent in dotfiles'
   `todos/ssh-agent.md` (*"I must type my password and unlock the key for any new
   terminal session"*), applied to agents.

6. **Use without exposure, where possible.** A tool should be able to *use* a credential
   without the model or the transcript seeing its value: an SSH agent signs without
   giving out the key; a proxy adds a token to requests (p2's placeholders); a credential
   helper hands git a token. Where only a value will do (an environment variable for a
   CLI), it's the last resort. *Why:* the transcript is stored, backed up and sent to
   Anthropic; a value that never enters the tool's process can't leak through it.

7. **Values are stored encrypted, outside pier's database.** The SQLite file, which is
   backed up and holds every transcript, never holds a credential's value. Values live
   where Will already keeps secrets (sops, 1Password, systemd credentials) or in a
   private store of pier's, encrypted. *Why:* the database is backed up and copied
   around, and holds transcripts that may be shared; keeping secrets out of it keeps the
   backup harmless, and reuses stores Will already trusts.

8. **Every use can be known.** pier records which credential a tool call was given, by
   name, never value, in the conversation. *Why:* when something goes wrong, Will can
   answer "which conversations could have used this?" and rotate the right things.

9. **Leaks are expected, and limited.** The model is told which credentials its
   environment holds, by name (`todos/environment.md`, plan step 3); tool
   results are scrubbed of known values; a credential can be rotated without changing
   any grant (principle 1). *Why:* prompt injection and plain mistakes will happen;
   design for recovery, not for never.

10. **Migration is gradual and reversible.** A project moves one secret at a time from
    its `.env` to a named credential, and its `.env` keeps working for Will's own shell
    meanwhile. Nothing breaks on the day the system arrives. *Why:* Will asked for a
    path, not a cutover.

11. **Not a boundary until there is one.** While tools run as Will with no sandbox
    (`todos/environment.md`, "Variables aren't a boundary"), a determined process can read Will's files and
    sockets. The system makes the safe path the easy one, and records use; it doesn't
    claim to stop what it can't. *Why:* the same honesty as "filtering isn't
    isolation". Isolation, when it comes, makes principles 2 and 6 enforced.

12. **Portable, and not Nix-only.** The system works with a plain config file and a
    store pier controls; Nix and sops are one way to fill it. *Why:* Will's
    "portable to non-Nix systems" (2026-11-24, question d).

13. **Carries over to p3.** Names, grants and the rules live in the layer, as data and
    a Durable extension, not in daemon code. *Why:* `docs/principles.md`, section 2.

## Migrating a `.env`, as these principles would have it

For vulcanus-proxmox, one secret at a time (sketch, not a design):

1. Will names the credential (`proxmox-api-token`, tier 1, a token) and stores its value
   where the design says (principle 7).
2. He grants it to the project (`~/repositories/vulcanus-proxmox`), delivered as the
   variable `TF_VAR_proxmox_api_token_secret` (principle 6's last resort, since
   Terraform reads it so).
3. He removes the line from `.env`. His own shell gets it from the same store (`op run`,
   `sops exec-env`, or pier's own `pier credential exec`), or he keeps a copy in his
   `.env` that pier's grant then overrides (principle 10).
4. From then on, pier knows the name, the tier and the grant, records each use, and
   scrubs the value from tool results.

## Design questions, for after the principles

In order, once Will has settled the principles:

1. **Where values live.** pier's own encrypted store; sops files (age key, as dotfiles
   and vulcanus-proxmox already use); 1Password (`op read`, the desktop app's approval);
   systemd credentials; a mix, by kind.
2. **How a tool receives each kind.** Environment variable; a file the tool's variable
   points at (`GIT_ASKPASS`, `KUBECONFIG`); an SSH agent of pier's holding only granted
   keys; a credential helper; an HTTP proxy with placeholders (p2's, needs a sandbox to
   force traffic through it).
3. **Where grants live.** pier's YAML config (decided as the daemon's config,
   2026-11-24) for standing grants; a Durable document per conversation for grants made
   in a conversation (`/grant`), so they fork and rewind with it.
4. **Tier 3.** A tool that parks until Will approves in the TUI (Durable 1.6.0's gates),
   or Will running it himself.
5. **Remote piers.** A conversation on thenixbeast attached from the deck uses
   thenixbeast's credentials, never the deck's (`todos/remote.md`, model A). An SSH agent
   forwarded from the deck is outside the contract.
6. **What the TUI shows:** the credentials a conversation holds, in the footer or a
   command (`/credentials`).

## Open questions for Will

1. **The rest of the principles:** keep them as a start (Will called the spec "a good
   start") and revisit each when its design question comes up?

## Done when

The principles are settled and recorded here, the design questions are answered, and a
first credential (the agents' GitHub token) is granted and used through the system. Then
what stays true goes in `README.md`, and this file is deleted.
