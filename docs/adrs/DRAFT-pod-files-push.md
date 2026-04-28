# DRAFT-ADR: Push declarative file state to agent pods

**Date:** 2026-04-27
**Status:** Draft
**Owner:** @jjeliga

## Context

ADR-024 established that the entity owning a credential declares which **env vars** the agent pod needs, and the platform materializes them at reconcile time. The parallel question — which **files** the agent pod needs, and how to keep them current without rolling the pod — was unanswered.

Issue #307 surfaced the first concrete instance: `gh auth status` for GitHub Enterprise needs `~/.config/gh/hosts.yml` populated based on which github-enterprise app connections the agent has been granted, and the file must update when grants change without restarting the pod.

But the pattern is broader. Other state in humr that could plausibly need to land as files in agent pods:

- **Per-agent UI-edited config** (system prompts, MCP server lists, channel allowlists) — currently lives in env or ConfigMaps that roll the pod on change
- **Schedule metadata** that some scheduled actions need to read at runtime
- **Channel metadata** (Slack workspace info, Telegram bot config) for tools that want it on disk
- **CLI configs that other tools require alongside their proxied auth** — e.g. `~/.gitconfig` for `user.name`/`user.email`, future gcloud / kubeconfig files that name a host or context (no credentials, just naming) — analogous to gh's hosts.yml, which lists the host but uses a sentinel for the token
- **Tool defaults / allowlists / non-sensitive policy** that a humr-managed CLI tool wants to read

**Compatibility with ADR-005 (agent never sees raw credentials).** This mechanism never writes a real secret to disk. Files can carry the same `humr:sentinel` token that env vars use, with the gateway swapping it on outbound requests for the relevant host (the gh hosts.yml case proves the pattern). Producers that would need to write a real credential to disk are out of scope — they violate the gateway model and should stay rejected.

The same three constraints apply to all of them:

- **Decouple from the agent image** — user-supplied images must keep working without humr-specific code baked in.
- **No pod restart on state change** — rolling the pod kills live conversations and in-flight tool runs.
- **Sub-second propagation** — "click thing in UI, then run command" must just work.

The third forces real-time push (polling is too slow); the first two force the work to live in a humr-owned process alongside the agent container, not inside it.

## Decision

Introduce a generic **pod-files push** mechanism — the filesystem-state analogue of ADR-024's connector-declared envs:

1. **Producers, not just connector entries.** Each managed file is owned by a `FileProducer` — an opaque function `(owner) → FileSpec[]` that fetches its own state from whatever source it cares about (OneCLI connections, humr secrets, schedules, …) and emits the file fragments it wants materialized. The platform never sees the source data; it only composes producer outputs by destination path.

2. **Sidecar.** Every agent pod runs a humr-owned `humr-config-sync` sidecar (the controller binary in a different mode) that holds an SSE connection to the api-server, receives `FileSpec`s, and merges them into the declared paths via the requested mode. The sidecar is in a separate container from the user's agent image; the two share an `emptyDir` for the managed paths.

3. **Push channel.** A single SSE endpoint `GET /api/instances/<id>/pod-files/events` per instance. Snapshot on connect, upsert on state change. Per-instance Bearer auth, identical to the existing MCP endpoint. In-process pub/sub on the api-server keys topics by **agent name** (so all instances of the same agent share a topic, since most current sources of state are agent- or owner-scoped).

4. **Publisher seam, source-tagged.** `PodFilesPublisher.publishForOwner(owner, agentName, source)` is the single entrypoint state-mutating services call after they touch state. Each producer declares the `source` it reads (e.g. `"app-connections"`); the publisher only runs producers whose source matches. Producers stay opaque about *what* state they read — only the source tag is used for routing. The SSE-connect snapshot path (`compute(owner)`) still runs all producers, since at that moment we don't know what changed since the sidecar last connected.

5. **Merge modes.** Currently one: `yaml-fill-if-missing`. Adds new top-level keys; for keys that already exist, fills only fields that are absent. Never overwrites a present field; never deletes. Preserves manual edits and unrelated content. Other modes (`json-merge`, `text-append`, `template-overwrite`) can slot in as needed.

6. **Owner impersonation when needed.** Producers running outside a live user JWT (snapshot path on SSE connect) can use Keycloak service-account + RFC 8693 with `requested_subject`. The api-server already exposes this via `onecli.onecliFetchAsOwner`; producers that need user-scoped reads from external systems use the same pattern.

The `github-enterprise → hosts.yml` case is the first registry entry; it's a small producer factory that closes over a `fetchConnectionsForOwner` function. Adding a different state source is one new producer factory in `producers/`, registered in `buildPodFilesRegistry`. No platform changes.

## Alternatives considered

- **Init container only.** Bootstrap once at pod start; mid-session changes stale until a manual restart. Rejected: sub-second goal explicitly forbids it.
- **Polling sidecar.** Simplest possible push-adjacent design; ~30 s lag. Rejected for the same reason.
- **Agent-runtime owns the file.** The harness-runtime container already in the pod could fetch and write. Rejected: couples a humr-platform concern to the user-replaceable agent image.
- **ConfigMap + subPath mount with auto-refresh.** Kubelet auto-projects non-`subPath` ConfigMap changes within ~1 minute. Rejected: latency too high, and ConfigMap-projected files are read-only (the design wants room for the agent to edit in place).
- **Connector-only abstraction.** What we shipped first — `ConnectorFile { provider, path, render(connection) }`. Rejected after one iteration: it bakes "OneCLI connections" into the type signature, foreclosing non-connection sources without a refactor. The producer abstraction is barely larger and source-agnostic.
- **Push the work into OneCLI (extend `envMappings` with files).** Single source of truth for connector contracts, but the project decided in #307's discussion that consumer-specific knowledge (gh CLI's hosts.yml shape) lives in humr, not OneCLI. Producer-specific code lives next to the consuming side.

## Consequences

- **Adding a managed file is one producer factory** plus an entry in `buildPodFilesRegistry`. The platform stays unchanged across new producers.
- **The pod spec stays static** across state changes. The sidecar and shared volume are present whenever `CONTROLLER_IMAGE` is set; their presence does not depend on which producers have content.
- **The agent image stays untouched.** Users can bring any image; the sidecar materializes files into a shared `emptyDir` that the agent container reads.
- **HOME is a single chart value.** `agentHome` (default `/home/agent`) is set once in the helm chart and read by both the controller (mount path, `HOME` env var) and the api-server (passed to producers, who compose paths under it). Producer paths are HOME-relative, never literal.
- **One shared mount path for now** (`${agentHome}/.config/gh`). Future producers needing different parent paths require additional `emptyDir` mounts on the pod template — small, mechanical change. Not yet generalized to "arbitrary paths under HOME" because that risks shadowing a user-image's existing files at those paths.
- **Cross-replica fanout is the only deferred scaling concern.** Multi-pod *agents* work today: the bus is keyed by agent name, so all pods of the same agent subscribed to the same api-server replica receive every publish. Multi-pod *api-server* is the open case.
- **Stale entries linger after revoke / source removal.** Producers can only add to files, not remove. Revoked hosts still appear in `gh auth status` until manually edited; gateway no longer swaps the sentinel, so calls fail loud. Accepted for safety against accidental data loss.
- **Sidecar refuses paths outside agent HOME.** Defense-in-depth: a buggy or compromised api-server payload pointing at `/etc/...` or using `..` traversal is rejected before any write. The sidecar reads its allowed prefix from a `--agent-home` flag matching the chart-level `agentHome`.
- **Fork jobs deliberately do not run the sidecar.** Forks are short-lived per-turn Jobs spawned for foreign-user impersonation; SSE setup overhead per pod isn't justified for that lifecycle, and the relay flow doesn't read pod-files state. If a future fork-relevant feature ever needs files materialized, this is the place to revisit — until then, pod-files state inside fork pods is unsupported on purpose.

## Future extensions (decisions, not open questions)

- **Paths outside the current shared mount.** When a producer needs a path under a different parent (e.g. `${agentHome}/.gitconfig`), append a new `emptyDir` + mount in the controller's pod-template builder. The mount-path set lives next to the existing `gh-config` block in `resources.go` — explicit list, reviewed change. Not generalized to "arbitrary paths under HOME" because mounting all of HOME shadows user-image files.
- **More producer sources.** New tags slot into `ProducerSource` in `pod-files/types.ts` (currently `"app-connections"` only). Each new state-mutating service calls `publishForOwner(.., "<its-source>")`; each producer reading that state declares matching `source`. Naming convention: name the *state source* (the system), not the action.
- **Multi-replica api-server fanout.** Plan: `pg_notify` on channel `pod_files:<agentName>`. Postgres is already in the stack. The `PodFilesBus` interface (`subscribe`/`publish`) is the swap-in seam — a postgres-backed implementation slots in with no caller changes. Trigger: actually scaling api-server beyond one replica.
