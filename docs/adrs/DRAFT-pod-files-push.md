# DRAFT-ADR: Push declarative file state to agent pods

**Date:** 2026-04-27
**Status:** Draft
**Owner:** @jjeliga

## Context

ADR-024 established that the entity owning a credential declares which **env vars** the agent pod needs, and the platform materializes them at reconcile time. The parallel question — which **files** the agent pod needs, and how to keep them current without rolling the pod — was unanswered.

Issue #307 surfaced the first concrete instance: `gh auth status` for GitHub Enterprise needs `~/.config/gh/hosts.yml` populated based on which github-enterprise app connections the agent has been granted, and the file must update when grants change without restarting the pod.

But the pattern is broader. Other state in humr that could plausibly need to land as files in agent pods:

- **User secrets** as files (`~/.aws/credentials`, `~/.ssh/id_rsa`, kubeconfigs, certs) — humr already has secrets, currently only as env vars
- **Per-agent UI-edited config** (system prompts, MCP server lists, channel allowlists) — currently lives in env or ConfigMaps that roll the pod on change
- **Schedule metadata** that some scheduled actions need to read at runtime
- **Channel metadata** (Slack workspace info, Telegram bot config) for tools that want it on disk

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

4. **Publisher seam.** `PodFilesPublisher.publishForOwner(owner, agentName)` is the single entrypoint state-mutating services call after they touch state. It re-runs every producer in the registry and publishes the merged result. Producers that don't care about that owner return empty arrays; the cost is small. Services don't need to know what producers exist or what state they own.

5. **Merge modes.** Currently one: `yaml-fill-if-missing`. Adds new top-level keys; for keys that already exist, fills only fields that are absent. Never overwrites a present field; never deletes. Preserves manual edits and unrelated content. Other modes (`json-merge`, `text-append`, `template-overwrite`) can slot in as needed.

6. **Owner impersonation when needed.** Producers running outside a live user JWT (snapshot path on SSE connect) can use Keycloak service-account + RFC 8693 with `requested_subject`. The api-server already exposes this via `onecli.onecliFetchAsOwner`; producers that need user-scoped reads from external systems use the same pattern.

The `github-enterprise → hosts.yml` case is the first registry entry; it's a ~30 LOC producer factory that closes over a `fetchConnectionsForOwner` function. Adding a different state source is one new producer factory in `producers/`, registered in `buildPodFilesRegistry`. No platform changes.

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
- **One shared mount path for now** (`/home/agent/.config/gh`). Future producers needing different parent paths require additional `emptyDir` mounts on the pod template — small, mechanical change. Not yet generalized to "arbitrary paths under HOME" because that risks shadowing a user-image's existing files at those paths.
- **Single api-server replica is the deployment baseline.** Multi-replica fanout (Redis pub/sub or pg notify) can slot in without changing the sidecar protocol.
- **Wasted work on each publish.** `publishForOwner` runs every producer regardless of which source mutated. Producers must be cheap (most return empty arrays). Acceptable until a producer is expensive enough to justify source-tagged invalidation.
- **Stale entries linger after revoke / source removal.** Producers can only add to files, not remove. Revoked hosts still appear in `gh auth status` until manually edited; gateway no longer swaps the sentinel, so calls fail loud. Accepted for safety against accidental data loss.

## Status / next steps

- First registry entry shipping in #307: `github-enterprise → /home/agent/.config/gh/hosts.yml`.
- Promote this DRAFT to a numbered ADR once the second producer (likely a non-connection-based one) lands and validates the abstraction.
- Open questions for the numbered version: (a) how to handle paths outside the current shared mount; (b) source-tagged publish to avoid unnecessary producer runs; (c) multi-replica fanout when api-server scales beyond one pod.
