# Humr is Multiplayer, not yet Multitenant

> **TL;DR.** Humr is multiplayer: one install hosts a team, each with their own agents, schedules, and credentials. Private by default. Shared on purpose through **channels** — the abstraction (Slack today, Telegram, later GitHub projects and others) that plugs an instance into a surface teammates can drive. Install-wide plumbing underneath — one Keycloak, one credential gateway, one templates catalog. Team-scale collaboration, not SaaS-grade tenant isolation: one install per trust boundary.

Every running agent in Humr — an **instance** — belongs to exactly one user, its **owner**. The owner is the only person who can manage the instance (start, stop, delete, change settings), and the instance runs under the owner's credentials by default. Multiplayer happens through **channels** ([vocabulary](../tseng/vocabulary.md#channels-bounded-context)): external pathways (Slack, Telegram, future GitHub/Discord/WhatsApp/…) that let the owner invite other users to drive the instance from a shared surface. So "two people on the same instance" is really "the owner, plus guests the owner brought in through a channel."

Channels are **read-only by default**. Putting an instance on a shared surface lets teammates *see* it and *follow* its conversations — but not talk to the agent. Write access is granted **explicitly, per user**, by the instance owner. Once a guest has write access and actually drives the agent, the turn runs under *that guest's* identity — the agent's outbound calls use their credentials, not the owner's (the "impersonation" mechanism from [ADR-027](adrs/027-slack-user-impersonation.md), detailed in [§1 below](#1-outbound-attribution-follows-whoevers-talking)).

(For the hostile-tenant answer, skip to [Why "not yet" multi-tenant](#why-not-yet-multi-tenant). Short version: not today — the install leans on shared plumbing by design, and real tenant isolation is a future upgrade, not a hidden feature.)

## Who you are

Humr's unit of identity is a **user** in Keycloak ([ADR-015](adrs/015-multi-user-auth.md)), which every install ships. Corporate SSO sits behind it. A Keycloak JWT rides every API call and drives every access decision.

Each channel type maps external identities back to a Keycloak `sub`:

- **Slack** — `/humr login` binds `slack_user_id ↔ keycloak_sub` ([ADR-018](adrs/018-slack-integration.md)).
- **Telegram** — no workspace, so `/login` authorizes per conversation ([ADR-029](adrs/029-per-instance-channels.md)).
- **Future types** — will follow one of the two patterns; identity still resolves to a Keycloak user.

Identity is people, not service accounts[^service-accounts]. No team object, no org-level ownership. If a teammate leaves, someone re-owns their agents by hand.

[^service-accounts]: Planned, not yet built. Autonomous things — schedules, webhooks, cron-driven runs — should really be attributed to a *service account* on a user's (or a team's) behalf, rather than to the human who happened to set them up. That distinction matters for audit trails ("who actually took this action?"), for handoff (a teammate leaving shouldn't silently break their schedules), and for credential scoping (a service account should carry a narrower set of keys than a person). Today all of this is collapsed onto the owning user; introducing service-account identity is tracked as future work.

## Your stuff

As the owner of an instance, you own everything attached to it: its schedules, the channels it's connected to, any per-instance bot tokens, and its conversations. Humr hides all of this from everyone else's UI by default — teammates can't see it, open it, or interact with it unless you've explicitly opened a door (through a channel, see below). Bot tokens you paste in (e.g. a Telegram bot's token) are write-only: once set, they never round-trip back into the UI. ([ADR-015](adrs/015-multi-user-auth.md), [ADR-006](adrs/006-configmaps-over-crds.md) for the implementation details.)

> **Example.** Alice creates `my-researcher`. She's its owner. Bob doesn't see it in his UI and can't message it. Once Alice binds it to a Slack channel Bob is in, Bob can now watch Alice's conversations with the agent — but he still can't intervene. Only when Alice adds him to the instance's allowed-users list does he get write access and can actually drive the agent. Even then, it's still *Alice's* instance; Bob is a guest.

## Your keys stay yours

Humr runs a fork of OneCLI as the credential gateway ([ADR-005](adrs/005-credential-gateway.md), [ADR-015](adrs/015-multi-user-auth.md)). Credentials are scoped per Keycloak `sub`. The API server exchanges the user's JWT for a OneCLI-scoped token via RFC 8693; OneCLI validates the exchanged token itself, so a compromised API server can't impersonate users.

Each agent pod gets one `ONECLI_ACCESS_TOKEN` tied to exactly one user, baked into `HTTPS_PROXY` at startup. Every outbound call — agent, `git`, `curl`, MCP tools — flows through OneCLI under that one user.

> **Example.** Bob has a GitHub PAT; Alice's agent asks GitHub for something. Alice's pod's proxy token is scoped to Alice. Bob's token never enters the picture.

**At any given turn, reachable credentials are limited to whoever drives that turn.**

## The workspace — persistent, shared across pods

Every instance has a **workspace** — a persistent volume mounted at `/home/agent` that outlives any single agent process. Anything the agent writes there — the git working tree, dependency caches, `~/.claude` transcripts, `MEMORY.md`, output files — survives restarts, hibernation, and even foreign-replier forks.

The runtime around the workspace is *not* persistent. The container OS, `/tmp`, ephemeral env vars, anything installed mid-turn outside `/home/agent` — all reset every time a pod starts. When an instance wakes from hibernation, or when a foreign replier's Fork spins up ([§1 below](#1-outbound-attribution-follows-whoevers-talking)), that new pod gets **fresh OS state but mounts the same workspace**.

This split is what makes multiplayer collaboration work mechanically. Two different pods — Alice's main pod and Bob's Fork — driving the same instance are literally reading and writing the same disk. They see the same git history, the same cached node_modules, the same `MEMORY.md`, the same session transcripts, because "the workspace" is one place, not a copy per player.

The workspace is per-instance, not install-wide. Alice's instance has its workspace; Bob's has its own; they're separate volumes. "Shared" here means *shared across every pod that touches one instance*, not shared between instances.

## Channels — the multiplayer mechanism

A **channel** is how an instance's owner lets other users drive it. It's an external pathway — Slack, Telegram, a future GitHub project or Discord server — that plugs the instance into a shared surface teammates can reach. Binding an instance to one does three things:

1. **Puts it on a shared surface** — teammates see it; authorized ones can drive it.
2. **Gates access per instance** — you decide who drives; watching is cheap.
3. **Makes sessions resumable** — a channel hosts one ACP session per conversation, so continuity survives multiple messages from multiple people ([ADR-025](adrs/025-thread-session.md)).

Existing channel types:

- **Slack** ([ADR-018](adrs/018-slack-integration.md)) — platform channel. One install-wide Slack app. Instances bind to specific Slack channels.
- **Telegram** ([ADR-029](adrs/029-per-instance-channels.md)) — per-instance channel. Each instance brings its own bot.
- **Future** (GitHub projects, Discord, WhatsApp, …) — pick one of the two patterns. Multiplayer dynamics below don't care which.

The interesting case: more than one player driving the same channel-bound instance. Three things happen.

### 1. Outbound attribution follows whoever's talking

If Alice owns an instance but Bob (a **Foreign Replier** — an authorized non-owner) replies in its channel, Bob's turn runs in a short-lived Kubernetes Job — a **Fork** — whose pod carries *Bob's* OneCLI token ([ADR-027](adrs/027-slack-user-impersonation.md)). So:

- PRs the agent opens during Bob's turn are authored by **Bob**.
- Model usage bills **Bob**.
- Rate limits and audit logs show **Bob**.

Alice's own turns run on the instance's main pod under her token — unchanged. Implemented for Slack today; extending to other channel types is mechanical.

### 2. Access is gated per instance

- **Slack** — two tiers: channel membership + linked `/humr login`, *and* a per-instance allowed-users list ([ADR-018](adrs/018-slack-integration.md) §3). Observers see, drivers drive.
- **Telegram** — per-conversation: until someone runs `/login`, the bot ignores the chat ([ADR-029](adrs/029-per-instance-channels.md)).

### 3. The workspace is shared on purpose

Because [the workspace](#the-workspace--persistent-shared-across-pods) is one persistent volume mounted by every pod that touches the instance, participants in a channel conversation share all of it: the git working tree, `~/.claude`, `MEMORY.md`, the ACP session transcript ([ADR-025](adrs/025-thread-session.md), [ADR-027](adrs/027-slack-user-impersonation.md) §2).

> **Example.** Alice reads a confidential doc through the agent. Bob replies later. The agent — same session — may reference facts from the doc when answering Bob, even though Bob never had direct access.

This is the right default for collaboration ("same workspace"), and it's the intuition behind allowed-users: **decide who's in the pair-programming room, not per-fact access.** Sensitive topics → different instance.

Concurrency (Alice in the UI + Bob in the channel at once) can race on git state; out of scope today ([ADR-027](adrs/027-slack-user-impersonation.md) §7).

## Why "not yet" multi-tenant

"Multi-tenant," in the SaaS sense, means hard walls between mutually distrusting customers. Humr isn't there today, and the multiplayer design leans on shared infrastructure on purpose — one namespace (label filtering, not namespace RBAC), one Keycloak realm, shared OneCLI, install-wide templates, one app per platform channel type. None of those are hostile-tenant boundaries.

The rule today is simple: **one Humr install per trust boundary.** A team = one install. Two teams that shouldn't see each other = two installs.

"Not yet" rather than "no" is deliberate. The upgrade path exists — namespace-per-user was considered and rejected on operational grounds ([ADR-015](adrs/015-multi-user-auth.md)), and is the natural step if a real hostile-tenant use case shows up. Per-user scoping already lives throughout the API server and credential gateway; hardening the infrastructure layer is the remaining gap, not a ground-up redesign.

## References

- [Security model](security-model.md) — what keeps the agent from escaping or exfiltrating; the companion to this doc.
- [Ubiquitous language](../tseng/vocabulary.md) — canonical definitions for *channel*, *instance*, *fork*, *foreign replier*.
- ADRs: [005](adrs/005-credential-gateway.md) credential gateway · [006](adrs/006-configmaps-over-crds.md) ConfigMaps over CRDs · [015](adrs/015-multi-user-auth.md) multi-user auth · [017](adrs/017-db-backed-sessions.md) DB-backed sessions · [018](adrs/018-slack-integration.md) Slack channel · [025](adrs/025-thread-session.md) session per conversation · [027](adrs/027-slack-user-impersonation.md) foreign-replier forks · [029](adrs/029-per-instance-channels.md) per-instance channels.
