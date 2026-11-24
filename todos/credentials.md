# Credentials: principles first, then a design

## Opening prompt

> Read `docs/principles.md`, `todos/environment.md` (the contract's Credentials group,
> and "Credentials, in tiers"), then `todos/credentials.md`. Will asked for the
> principles of a credentials system before its design. Put the principles below to him
> one by one, and record what he keeps, changes or drops, verbatim and dated. Don't
> design the implementation until he's settled them. Then take "Design questions" in
> order.

Written 2026-11-24, at Will's request: *"What matters more then is designing a good
"Credentials" system such that a project's sensitive values previously stored in the
`.env` file can be later migrated to the "Credentials" system - allowing stronger access
controls. In this conceiving, one should define the principles behind the Credentials
system before then designing the implementation."*

It follows from his axiom of the same day (`todos/environment.md`, question c): a
conversation pointed at a project may see that project's `.env`. That's the floor. This
system is how a project, or Will's own credentials, get more control than that.

Everything below is Claude's proposal until Will agrees, except what's marked decided.

## Decided already

- **Tiers** (Will, 2026-11-24: *"I like your tiers"*), from `todos/environment.md`:
  0 none; 1 project and tools; 2 infrastructure (SSH to other machines); 3 root on this
  machine.
- **A GitHub token made for agents** (Will, 2026-11-24: *"Yes to a `GitHub` token made
  for agents."*).
- **Which machines and users an agent's SSH key reaches** waits for implementation
  (Will, 2026-11-24).
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
  (`todos/environment.md`, Prior art): both filter variables by name; both say this isn't
  a boundary.
- **OpenSSH's agent** can constrain a key: a lifetime (`ssh-add -t`), the hosts it may be
  used for (`ssh-add -h`, 8.9 and later), and confirmation before each use (`ssh-add -c`,
  with an askpass program).
- **sops-nix and systemd credentials** (`systemd-creds`, `LoadCredential=`): secrets as
  files given to one service, readable only by it, never in its environment.

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
   environment holds, by name (`todos/environment.md`, "Telling the model"); tool
   results are scrubbed of known values; a credential can be rotated without changing
   any grant (principle 1). *Why:* prompt injection and plain mistakes will happen;
   design for recovery, not for never.

10. **Migration is gradual and reversible.** A project moves one secret at a time from
    its `.env` to a named credential, and its `.env` keeps working for Will's own shell
    meanwhile. Nothing breaks on the day the system arrives. *Why:* Will asked for a
    path, not a cutover.

11. **Not a boundary until there is one.** While tools run as Will with no sandbox
    (`todos/environment.md`, "Reach"), a determined process can read Will's files and
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

1. **The principles:** which to keep, change or drop? Anything missing?
2. **Principle 6, use without exposure:** worth the extra machinery (an agent, helpers,
   a proxy) for the credentials that allow it, or is an environment variable enough
   until there's a sandbox?
3. **Principle 7:** values never in pier's SQLite file, agreed? Any store Will would
   rule out, or prefer (1Password, sops)?

## Done when

The principles are settled and recorded here, the design questions are answered, and a
first credential (the agents' GitHub token) is granted and used through the system. Then
what stays true goes in `README.md`, and this file is deleted.
