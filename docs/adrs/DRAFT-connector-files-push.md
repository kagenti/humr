# DRAFT-ADR: Connector-declared files, pushed live to agent pods

**Date:** 2026-04-27
**Status:** Draft
**Owner:** @jjeliga

## Context

ADR-024 established that the entity owning a credential declares which **env vars** the agent pod needs. The parallel question — which **files** the agent pod needs — was unanswered. Issue #307 surfaced the first concrete instance: `gh auth status` for GitHub Enterprise needs `~/.config/gh/hosts.yml` populated, and there's no path to put it there without rolling the pod on every grant change.

Three requirements pulled the design in opposite directions:
- **Decouple from the agent image** — user-supplied images must keep working without humr-specific code baked in.
- **No pod restart on grant/ungrant** — rolling the pod kills live conversations and in-flight tool runs.
- **Sub-second propagation** — "click connect, then run `gh auth status`" must just work.

The third forces real-time push (polling is too slow); the first two force the work to live in a humr-owned process running alongside the agent container, not inside it.

## Decision

Introduce a generic **connector-files push** mechanism, parallel in spirit to ADR-024's connector-declared envs:

1. **Registry** — humr maintains an in-code registry of `ConnectorFile` entries. Each entry declares the provider it cares about, the file path inside the agent pod, the merge mode, and a `render(connection) → fragment` function that turns one connection's metadata into a content fragment.

2. **Sidecar** — every agent pod runs a humr-owned `humr-config-sync` sidecar (the controller binary in a different mode) that holds an SSE connection to the api-server, receives the rendered fragments, and merges them into the declared paths via the requested mode. The sidecar is in a separate container from the user's agent image; the two share an `emptyDir` for the managed paths.

3. **Push channel** — a single SSE endpoint `GET /api/instances/<id>/connector-files/events` per instance. Snapshot on connect, upsert on grant. Per-instance Bearer auth, identical to the existing MCP endpoint. In-process pub/sub on the api-server keys topics by **agent name** (since OneCLI grants are agent-scoped).

4. **Merge modes** — currently one: `yaml-fill-if-missing`. Adds new top-level keys; for keys that already exist, fills only fields that are absent. Never overwrites a present field; never deletes. Preserves manual edits and unrelated content. Other modes (`json-merge`, `text-append`) can slot in later.

5. **Owner impersonation for snapshots** — the sidecar runs without a live user JWT, so the api-server uses Keycloak service-account + RFC 8693 with `requested_subject` (the same pattern the controller already uses for OneCLI calls) to fetch the owner's connections at SSE-connect time.

The `github-enterprise → hosts.yml` case is the first registry entry; it lives in one small file. Adding a future provider's file (e.g. `aws-credentials`, `gcloud config`, `npmrc`) is one new entry — no platform changes.

## Alternatives considered

- **Init container only.** Bootstrap once at pod start; mid-session grants stale until a manual restart. Rejected: sub-second goal explicitly forbids it.
- **Polling sidecar.** Simplest possible push-adjacent design; ~30 s lag. Rejected for the same reason.
- **Agent-runtime owns the file.** The harness-runtime container already in the pod could fetch and write. Rejected: couples a humr-platform concern to the user-replaceable agent image.
- **ConfigMap + subPath mount with auto-refresh.** Kubelet auto-projects ConfigMap changes into non-`subPath` mounts within ~1 minute. Rejected on two counts: latency too high, and mounts are read-only — the spec required leaving room for the agent to edit the file in place.
- **Push the work into OneCLI (extend `envMappings` with files).** Architecturally clean (single source of truth for connector contracts), but the project decided in #307's discussion that gh-CLI-specific knowledge should live in humr, not OneCLI. Provider-specific code lives next to the consuming side.
- **Per-provider one-off implementations.** What we almost shipped. Rejected because the platform infrastructure (SSE channel, sidecar, merge engine, impersonation) is ~20× the size of the gh-specific bits — building it as a one-off forfeits the leverage.

## Consequences

- **Adding a new provider's file is ~20 LOC** (one registry entry). The platform stays unchanged.
- **The pod spec stays static** across grant/ungrant. The sidecar and shared volume are present whenever `CONTROLLER_IMAGE` is set; their presence does not depend on connection state.
- **The agent image stays untouched.** Users can bring any image; the sidecar materializes files into a shared `emptyDir` that the agent container reads.
- **One shared mount path for now** (`/home/agent/.config/gh`). Future providers needing different parent paths require additional `emptyDir` mounts on the pod template — small, mechanical change. Not yet generalized to "arbitrary paths under HOME" because that risks shadowing a user-image's existing files at those paths.
- **Single api-server replica is the deployment baseline.** Multi-replica fanout (Redis pub/sub or pg notify) can slot in without changing the sidecar protocol.
- **Stale entries linger after revoke.** Spec choice: never delete from the file. Revoked hosts still appear in `gh auth status` until manually edited; the gateway no longer swaps the sentinel, so calls fail loud. Accepted for safety against accidental data loss.

## Status / next steps

- First registry entry shipping in #307: `github-enterprise → /home/agent/.config/gh/hosts.yml`.
- Promote this DRAFT to a numbered ADR once the second registry entry lands and the abstraction has been validated against a real second use case.
- Open question for the numbered version: how to handle paths outside the current shared mount. Likely answer: registry entries can declare their own mount root, controller groups them at reconcile time. Not solved here.
