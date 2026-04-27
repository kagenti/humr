# `gh auth status` for GitHub Enterprise — design

**Date:** 2026-04-27
**Issue:** [#307](https://github.com/kagenti/humr/issues/307)
**Branch:** `fix/307-gh-auth-status-w-apps-fix`

## Problem

`gh auth status` fails for GitHub Enterprise inside agent pods. The user expects: connect a github-enterprise app via OneCLI → run `gh auth status --hostname <enterprise>` from the agent → see the account listed.

Today this fails because:
- `gh` CLI does not auto-discover enterprise hosts. Its sources are `~/.config/gh/hosts.yml` or the `GH_HOST` env override.
- The pod has neither: nothing writes `hosts.yml`, and `GH_HOST` is unacceptable because it would force a single active host across `github.com` and any enterprise host (they must coexist).
- The `GH_TOKEN=humr:sentinel` env var that makes `github.com` work is irrelevant for enterprise — `gh` only consults it for `github.com`.

`git clone/push` to enterprise already works because the OneCLI gateway intercepts traffic and swaps Basic auth on the host extracted from the connection's `metadata.baseUrl`. The gap is purely `gh` introspection.

## Goals

- After granting a github-enterprise connection, `gh auth status --hostname <enterprise-host>` from inside the agent works **within ~1 second** of the click.
- Agent image is **untouched** — user-supplied agent images keep working.
- Granting/ungranting a connection **does not roll the agent pod** for our concern. (Existing env-list-induced rolls are out of scope.)
- `hosts.yml` is treated as **shared, write-conservative state**: never overwritten, never destructively edited, never deleted.
- All logic on the humr side. **No OneCLI changes.**

## Non-goals

- Writing `~/.git-credentials` (git ops already work via the proxy).
- Adding a `GH_ENTERPRISE_TOKEN` env var (`oauth_token` in the file is sufficient).
- Adding an entry for `github.com` to `hosts.yml` (works via existing `GH_TOKEN`).
- Deleting entries when a connection is revoked (entries persist; gateway will simply fail to swap, which is acceptable degradation).
- Refreshing the `user:` field after first write (write-once for that field; user can edit manually).
- Generic provider-declared "config files" mechanism. Scoped to github-enterprise only; can generalize later if a second provider needs it.

## Architecture

A dedicated **sidecar container** in every agent pod owns `~/.config/gh/hosts.yml`. The sidecar holds a long-lived SSE connection to the api-server. On any event (snapshot at connect-time, or upsert on grant), the sidecar performs a **read-modify-write merge** of the file using "fill-if-missing" rules. The agent container reads the file via a shared `emptyDir` mount; it never knows where the file came from.

```
┌─────────────────────────── agent pod ───────────────────────────┐
│                                                                 │
│  ┌── agent container (USER-PROVIDED IMAGE) ─────────────────┐   │
│  │  • runs the harness                                      │   │
│  │  • mounts shared emptyDir at /home/agent/.config/gh/     │   │
│  │  • `gh` reads $HOME/.config/gh/hosts.yml                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌── humr-config-sync sidecar (controller image) ──────────┐    │
│  │  • mounts same shared emptyDir                          │    │
│  │  • holds SSE connection to api-server                   │    │
│  │  • on snapshot/upsert event: read-modify-write hosts.yml│    │
│  │  • reconnect with backoff on drop                       │    │
│  │  • restart-only-self on crash                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  emptyDir volume: /home/agent/.config/gh/  (in both containers) │
└─────────────────────────────────────────────────────────────────┘
```

### Why sidecar (not init container, not in agent-runtime)

- **Init container only**: file is stale until pod restart after a grant. Unacceptable per goals.
- **In agent-runtime**: would couple a humr-platform concern to the user-replaceable agent image.
- **Sidecar in controller image**: humr-owned, stays alongside any user-provided agent image, separate failure domain.

### Why SSE (not WebSocket, not polling)

- Polling at any reasonable interval (≥30 s) violates the latency goal.
- WebSocket is bidirectional, which we don't need — only api-server pushes.
- SSE is plain HTTP, supports reconnect-with-Last-Event-ID, and is the simplest fit for "snapshot then deltas".

### Why an `emptyDir` (not `PVC`, not `ConfigMap`)

- ConfigMap mounts are RO and would either re-roll the pod or live alongside an emptyDir-overlay (more moving parts).
- PVC adds storage, ordering, and storage-class concerns for a file that is regenerated on demand.
- `emptyDir` is writable, ephemeral, free; the bootstrap `snapshot` rebuilds state on every pod start.

## Components

### 1. API server: SSE endpoint

**Route:** `GET /api/instances/<name>/gh-enterprise/events`
**Content-Type:** `text/event-stream`
**Auth:** existing per-instance mechanism (same one agent-runtime uses to call api-server).

**Events (one JSON payload per event):**
- `event: snapshot` — sent immediately on connect. Body: `{ connections: [{ host, username }, ...] }` listing all currently-granted github-enterprise connections for this instance's owner. May be empty.
- `event: upsert` — sent when a `setAgentConnections` call adds (or no-ops) a github-enterprise grant for this instance's owner. Body: `{ connections: [{ host, username }, ...] }` containing only the affected connection(s).
- (No `delete` / `revoke` events — we never delete from the file.)

**Server-side plumbing:**
- In-process pub/sub keyed by `instanceName`. The connections-service emits a publish call when it processes a github-enterprise grant; the SSE handler subscribes per active client.
- Single api-server replica is the deployment baseline (no cross-replica coordination needed). If the deployment scales to multiple replicas later, an additional fanout layer (Redis pub/sub or a DB notify) can be slotted in without changing the sidecar protocol.
- Snapshot generation reuses `connections-service.list()` + the existing `findAgentByIdentifier` + `getAgentAppConnectionIds` paths, filtered to `provider === "github-enterprise"`. `host` is derived from `metadata.baseUrl` using the same parser the gateway uses ([apps.rs:347-352](context/onecli/apps/gateway/src/apps.rs#L347-L352)). `username` is `metadata.username` (falling back to `metadata.login`, then `metadata.name`, then omitted).

**Connection identity:** the sidecar authenticates with the per-instance credential already used by agent-runtime. The api-server resolves the owner from that credential, so the SSE stream is implicitly scoped to that owner's connections.

### 2. Controller binary: `config-sync` subcommand

**Invocation:** `controller config-sync --instance=<name> --api-server-url=<url> --out=<path> [--reconnect-min=1s --reconnect-max=30s]`

**Flow:**
1. Open SSE: `GET <api-server-url>/api/instances/<instance>/gh-enterprise/events` with the per-instance auth header.
2. For each event received, decode the JSON payload, then for each connection in `connections[]`:
   - Read existing `hosts.yml` (treat as empty document if file does not exist).
   - Look up the host key.
     - **Absent**: add a new entry with full fields:
       ```yaml
       <host>:
           oauth_token: humr:sentinel
           git_protocol: https
           user: <username>
       ```
       Omit `user:` when no username is available.
     - **Present**: under that host, only set fields that are currently absent. Never overwrite present fields. Never remove fields.
   - If the resulting document differs from what's on disk, **atomic-write** (write to `<out>.tmp`, fsync, rename). If identical, no write.
3. On stream end / network error: backoff (exponential, capped at `--reconnect-max`) and reconnect. The reconnect re-receives a `snapshot` and re-applies — self-healing.

**Implementation notes:**
- ~60 lines of Go: `net/http` for SSE (line-buffered reader splitting on `\n\n`), `gopkg.in/yaml.v3` for read-modify-write (already a transitive dep via k8s.io libraries), `os.Rename` for atomic write.
- Logs every applied change at INFO; logs every reconnect attempt at DEBUG.
- Exits non-zero only on irrecoverable config errors (missing flags). Network/protocol errors trigger reconnect, never exit — K8s would just restart us anyway.

### 3. Pod template (controller-injected, static)

In [packages/controller/pkg/reconciler/resources.go](packages/controller/pkg/reconciler/resources.go):

- Add a new `emptyDir` volume `gh-config`.
- Add a new `volumeMount` to the **agent container**: `gh-config` at `/home/agent/.config/gh/`.
- Add a **new sidecar container** to the StatefulSet pod template:
  - Name: `humr-config-sync`
  - Image: same as the controller image (resolved from the same Helm value).
  - Command: `[/controller, config-sync, --instance=$(POD_NAME-or-instance-name), --api-server-url=$(API_SERVER_URL), --out=/home/agent/.config/gh/hosts.yml]`
  - Env: shares `API_SERVER_URL`, the per-instance auth env(s), and any `HTTPS_PROXY`/`SSL_CERT_FILE` already set on the agent container (so the sidecar talks to api-server via the same network path the agent uses, including OneCLI MITM CA trust).
  - VolumeMount: `gh-config` at `/home/agent/.config/gh/`.
  - Resources: minimal requests/limits (e.g., `cpu: 10m, memory: 16Mi requests / 50m, 64Mi limits`).
  - RestartPolicy: implicit pod-level (sidecar restarts on its own crash; does not restart the agent container).

The sidecar and the volume are added unconditionally to every agent pod template. No reconcile-time branching based on whether any connections are granted — the sidecar handles the empty case.

## Data flow walkthroughs

### Bootstrap (pod start)

1. Pod starts. Both containers come up in parallel.
2. Sidecar opens SSE to api-server. Server immediately emits a `snapshot` event with whatever github-enterprise connections are currently granted to this instance's owner.
3. Sidecar applies the snapshot: file is created with one entry per connection.
4. Agent container, when it later runs `gh auth status`, reads the file and lists the enterprise hosts.

If the snapshot is empty: file is not created; `gh auth status` shows only `github.com` (existing GH_TOKEN behavior).

### Live grant during a session

1. User clicks the github-enterprise grant in the Configure Agent dialog.
2. UI submits → api-server `setAgentConnections` runs.
3. After OneCLI confirms the grant, the connections-service publishes an `upsert` event for the instance(s) owned by this user that have an active SSE client.
4. Sidecar receives the `upsert` within ~milliseconds. Reads file, looks up the host key (absent), adds the new entry, atomic writes.
5. User opens a terminal, runs `gh auth status --hostname <enterprise>` — the host is listed, the gateway swaps the sentinel on the `/user` API call, and the real account info is shown.

### Live revoke

1. `setAgentConnections` removes a github-enterprise connection.
2. **No event is sent.** The file is unchanged. The host entry remains.
3. Subsequent `gh auth status` calls for that host trigger a `/user` API call → gateway has no valid grant → call fails → gh CLI reports an auth failure for that specific host.
4. Other hosts in the file continue to work.

This is the explicit "never delete" tradeoff: stale entries linger after revoke, but they fail loud rather than disappearing.

### SSE drop

1. Connection drops (api-server restart, network blip).
2. Sidecar reconnects with backoff.
3. On reconnect, server sends a fresh `snapshot`. Sidecar re-applies. Any grant that happened during the drop is now reflected.

### User manually edits `hosts.yml`

- User adds a new host entry by hand. The sidecar **never deletes it** and **never overwrites any of its fields** on subsequent events. Preserved indefinitely.
- User changes `oauth_token` for a humr-managed host to a real token. The sidecar **does not overwrite it** because the field is already present. The user has effectively opted out of gateway-mediated auth for that host.

## Edge cases & failure modes

| Scenario | Behavior |
|---|---|
| api-server unreachable at startup | Sidecar retries with backoff. File stays empty/absent until first successful connect. `gh auth status` shows only `github.com`. |
| api-server unreachable mid-session | Sidecar reconnects. File state stays as-of last snapshot/upsert; new grants invisible until reconnect. |
| Sidecar crash | K8s restarts the sidecar container only. Bootstrap re-applies state. Agent container untouched. |
| OneCLI returns malformed `metadata.baseUrl` | Connection skipped from snapshot/upsert with a WARN log. Other connections still applied. |
| Two connections to the same enterprise host | Snapshot includes both; deterministic order (sorted by connection ID); first one wins for new-entry creation. The second's `username` does not overwrite the first's. |
| Pod with no github-enterprise connections | Sidecar runs idle, holds an SSE connection that only ever sees an empty snapshot. No file written. Cost: one TCP connection per agent pod. |
| Empty `username` field in metadata | Entry created without `user:` key. `gh auth status` will lazily resolve it via `/user` API call. |
| User provides a custom agent image with non-default `USER` | `HOME=/home/agent` is set on the pod env; the mount point and gh CLI lookup both honor it. Works as long as the user's image doesn't override `HOME`. |

## Testing

- **Unit (Go, sidecar):**
  - `mergeHostsYAML(existing, connections)` pure function: empty existing + non-empty connections → full entries; existing entry → only fills missing fields; existing entry with all fields → no change; multiple connections → all applied; empty connections → identity.
  - SSE event parser: malformed payload skipped, well-formed dispatched, multi-event stream handled.
  - Atomic write: tmp file + rename, no partial writes visible to readers.
- **Unit (TypeScript, api-server):**
  - Snapshot generation filters by `provider === "github-enterprise"`, parses `baseUrl`, falls back through `username → login → name → omit`.
  - Pub/sub: publishing for instance A does not deliver to subscribers of instance B.
  - SSE handler emits `snapshot` immediately on connect; emits `upsert` on publish; closes cleanly on client disconnect.
- **Integration:**
  - Existing controller reconciler test for resources gets a case asserting the sidecar container, the volume, and the matching mount in both containers.
  - Existing connections-service test gets a case asserting an `upsert` is published when a github-enterprise grant is added; not published when only github.com is granted.

## Rollout

- Single PR. Behind no feature flag; the change is additive and backwards-compatible for pods without any github-enterprise connections (sidecar runs idle).
- After merge: cluster upgrade rolls all agent pods (StatefulSet template change). This is a one-time roll across the fleet, expected as part of the release.

## Open questions for implementation

(None blocking the spec; all are routine implementation decisions.)

- Exact name of the sidecar binary subcommand: `config-sync` proposed.
- Resource requests/limits — start at `cpu: 10m, memory: 16Mi requests / 50m, 64Mi limits`; tune from observation.
- Reconnect backoff parameters: start at `1s → 30s` exponential, jitter 20%.
