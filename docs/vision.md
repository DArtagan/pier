# What pier is for

Why pier exists, what it's for, and how it should change as pi and p3 do.
`docs/principles.md` says how to work on it; this says why. Written 2026-11-16, from
that day's conversation, at Will's request. It describes Claude's framing, which Will
asked to have written down; anything he changes takes precedence.

## The ecosystem, by layer

| Layer | Who owns it | What it is |
|---|---|---|
| Models | pi-ai; Claude Code, through pi-claude-code | Talking to models. Through pi-claude-code, Claude Code is the gateway to Will's Claude subscription, not an agent. |
| Harness | Pi Durable | Persistent sessions: a turn survives crashes and restarts; branches; compaction. |
| Isolation | pi-env, Gondolin | Where tools run: this machine, over SSH, micro-VMs. |
| Distribution | Chord | State between processes and devices, plugins, hot reload. |
| Interfaces | pi-tui; React and Elanor | What a person looks at. |
| Apps | classic `pi` (no Durable); p2 and p3 ("Pi Roam"), on Durable and Chord; third parties such as pi-web | Products built from the layers above. |
| Services | Radius | Earendil's paid gateway, relay, backups, sign-in, and later hosting. |

pier is a small app on the layers Earendil treats as stable (pi-ai, Durable, pi-tui),
with pi-claude-code. It leaves out the ones still moving: Chord's app kit, which is
moving into p3, and Radius.

## pier's three jobs

1. **A stopgap:** Durable sessions in tmux panes now, before p3 can hold a
   conversation. It ends when p3 does that well enough.
2. **A test bed:** running Durable for real, and finding what breaks. The gate and the
   runs by hand found that:
   - a request's abort signal ends with its task step;
   - tools and Claude Code escape a process-group kill;
   - output is shown before it's stored;
   - Claude Code reports its own working directory to the model;
   - Claude Code processes leak unless released.

   p3 will meet these too. The knowledge outlives the code.
3. **Will's layer:** what's specific to Will rather than to Pi. Earendil has no reason
   to build it, and p3's docs don't mention Claude Code. It's the part meant to last:
   - Claude through his subscription;
   - NixOS packaging and systemd;
   - the pane's environment (devenv, SSH) reaching the agent's tools;
   - his AGENTS.md, skills and tools (Todoist, Calendar through `gog`, ketch,
     mini-nas);
   - local-first data, and the tailnet.

## The code: layer and host

The two jobs that last and the one that doesn't live apart:

- **`src/layer/`** is what carries over to p3, as plugins: the provider
  (`claude-code.ts`, with `ConversationDirectories`) and the prompt (`prompt.ts`). New
  tools, automations and providers go here. It may use pi's and Durable's packages,
  never the host: `test/layer.test.ts` fails if it imports anything from
  `src/host/`.
- **`src/host/`** is what's thrown away when p3 takes over: the daemon, the
  protocol, the client, the terminal client, the web UI and the CLI. It uses the
  layer.

## What to build on it

- **Worth building:** it carries over, and only Will would build it.
  - Will's tools as Durable extensions in the layer: Todoist, Calendar, ketch,
    mini-nas.
  - Long-running and scheduled work. Durable sleeps until a time durably (a morning
    check of the backups, watching a pull request), and its next release lets a tool
    park until an outside signal. This is what Durable has that classic pi doesn't.
  - Notifications when a run waits or fails (Pushover, from mini-nas's todo).
  - The Nix module and user service, which become the way to run p3 on Will's hosts
    once p3 ships as a package.
- **Building by Will's decision, though it won't carry over:**
  - the terminal client, made good for daily use (done 2026-11-17; `docs/history.md`,
    "The terminal client, for daily use"), changed further as daily use asks;
  - a web UI on Elanor, reachable locally and over the tailnet, phone first
    (`todos/web.md`). Will, 2026-11-16: what Earendil will build is unclear, and he
    wants it sooner. If p3's web UI covers most of the same ground, pier's is
    deprecated.
- **If daily use asks:** an ACP adapter, so Zed can attach to a conversation;
  bringing classic pi sessions into pier.
- **Not worth building** (`docs/principles.md`, section 1): several users, a plugin
  system, Radius, public exposure, an orchestration UI. They're p3's core, and building
  them in pier means building them twice.

## How it changes as p3 does

| When | pier |
|---|---|
| Now to early December | The thin slice in daily use; packaging; the terminal client for daily use; the web UI; Will's tools as layer extensions. |
| p3 ships a release that holds a conversation | Run p3 beside pier, with pi-claude-code as a p3 models plugin. The gate turns into a check of p3 with Will's provider. |
| p3's web UI covers most of what pier's does, on Will's hosts and phone | pier's web UI is deprecated and removed (Will, 2026-11-16). |
| p3 also has environments, the prompt from AGENTS.md, and a usable terminal client | The layer becomes p3 plugins, and the host retires. `pier` becomes Will's p3 plugins, his Nix module, and the gate. |
| p3 drifts from self-hosting (Radius first, or hosted first), or from Claude subscriptions | pier stays as the lightweight local host for Durable. It needs Durable, not p3. |

The last row is why pier is kept, thin, rather than dropped. Earendil's dated plan (in
p3's decisions, 2026-11-13) is "Dec 1 Pi Roam, Dec 18 Org Devices …, February
hosted", and its business is Radius. Will's principles (local first, his own
subscription, no hosted service in the path) won't always be p3's priorities.

Next check: early December, against that 1 December date. Have p3's slices 3, 7, 8
and 9 (a conversation, models, environments, the prompt), its terminal client and its
web UI landed, and is there a release?

## The long-term vision

- **Earendil's**, in p3's own words: "one Pi per person". A persistent, fully
  extensible agent instance, which agents can write plugins for, reachable from any
  device. Then extended to organisations, and hosted by Earendil, with Radius
  connecting it all.
- **Will's** (2026-10-28):
  - the interface separated from the harness;
  - terminal, web and phone access;
  - isolated agent environments;
  - eventually orchestration.

  Much the same vision. They differ in where it runs and whose services it depends on.
- **The end state pier aims at:** Will's Pi on Will's machines. Earendil's p3 provides
  the interfaces, sessions and distribution. Will's layer adds the provider, his tools
  and automations, isolation through pi-env and Gondolin on his own machines, and Nix to
  deploy it. pier gets there early, learns what breaks, and keeps a way out.
