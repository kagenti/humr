# ADR-DRAFT: Slack per-turn user impersonation — foreign repliers fork the instance into a K8s Job

**Date:** 2026-04-21
**Status:** Proposed
**Owner:** @tomkis
**Amends:** ADR-018
**Builds on:** ADR-015, ADR-005

## Context

Today, a Slack thread is routed to a single Humr instance by the `threadTs → instance_id` mapping (ADR-018). Every reply in that thread is relayed to the same instance, and the agent pod makes outbound calls (GitHub, Anthropic, etc.) through OneCLI using the **instance owner's** identity — the OneCLI access token baked into the pod by the controller is scoped to whoever created the instance (ADR-015).

This conflates two distinct concepts:

1. **Which instance handles the turn** — naturally scoped to the thread: same workspace, same agent config, same conversation.
2. **Whose credentials back the outbound calls during the turn** — should follow the **replier**: if Alice started the thread but Bob replies asking the agent to open a PR, the PR should be opened as Bob, not Alice.

### Why the obvious fix doesn't work

The initial draft of this ADR proposed passing a per-turn api-key through ACP `_meta` and having the agent-runtime swap the pod's OneCLI credentials for the turn. This is not implementable, because the OneCLI token is not a request-time parameter — it is **structural** to the pod:

- The controller stores the token in a per-agent K8s Secret `humr-agent-{agentName}-token` and injects it as `ONECLI_ACCESS_TOKEN` (see `resources.go:28-38`).
- Both `HTTPS_PROXY` and `HTTP_PROXY` are set to `http://x:$(ONECLI_ACCESS_TOKEN)@gateway:port` and resolved by Kubernetes at pod startup (`resources.go:26,39-42`).
- All outbound traffic from the agent process, its child processes (git, curl, npm), and every tool it spawns goes through this proxy. The credential routing lives in the container's environment, not in the agent-runtime.
- There is no hook to change the proxy auth between turns: env vars are frozen at container start, and child processes inherit the frozen copy.

Per-turn impersonation therefore cannot be done by mutating state inside the running pod. It has to be done by running the turn in a **different execution environment** that has the replier's credentials baked in from its own startup.

## Decision

### 1. Outbound identity follows the replier, via forked execution

For each Slack message relayed to an instance:

- If the replier **is the instance owner**, the turn runs in the main StatefulSet pod, exactly as today. No change.
- If the replier **is a foreign user** (linked via `/humr login` but not the owner), the turn runs in a **per-turn Kubernetes Job** whose pod has the replier's OneCLI token baked into its `HTTPS_PROXY` from startup.

Thread routing (`threadTs → instance_id`) is unchanged — the instance is still bound to the thread. What changes is *where* a given turn executes: owner turns go to the main pod; foreign turns go to a short-lived Job.

### 2. Forked Jobs mount the instance's PVC via RWX

The forked Job pod mounts the same `/home/agent` PersistentVolumeClaim as the main pod. This requires switching the PVC's access mode from `ReadWriteOnce` to `ReadWriteMany` so that the main pod and the Job pod can mount it simultaneously.

Consequences:

- **Storage class must support RWX.** For the k3s-on-lima development cluster, the default `local-path` provisioner does not support RWX; we will ship `nfs-server-provisioner` as part of the Humr chart's dev-cluster install flow. It runs an in-cluster NFS server as a StatefulSet backed by `local-path`, and exposes RWX PVCs on top of that export — self-contained, one Helm install, no host-level NFS setup. Production deployments on managed K8s use the cloud-native RWX options (EFS, Filestore, Azure Files).
- **Session continuity is automatic.** Claude Code's session transcript lives at `/home/agent/.claude/projects/…/*.jsonl`, which is on the shared PVC. A Job can resume the session by calling `unstable_resumeSession({ sessionId })` — the agent-runtime invokes Claude Code with `--resume`, which reads the same on-disk JSONL that the main pod last wrote. New messages append to the same file, so the next main-pod turn picks up Bob's contribution transparently.
- **Working tree is shared.** Git history, dependency caches, `.claude` state, MEMORY.md — all of it is the same bytes across the main pod and the Job. This matches the "we're working on this together" model of shared Slack threads.

### 3. Job spec — short-lived, one turn, auto-cleanup

For each foreign-user turn the controller creates a Kubernetes Job:

- **Image, command, init containers**: identical to the instance's StatefulSet pod, so agent-runtime boots the same way and serves ACP on `:8080`.
- **Volume mounts**: the instance's RWX PVC at `/home/agent`; the CA-cert emptyDir populated by the existing fetch-ca-cert init container.
- **Env**: the replier's `ONECLI_ACCESS_TOKEN` (from a Secret minted per foreign user, see §4) plus the instance's connector env vars derived from the replier's OneCLI secret access.
- **Lifecycle**: `restartPolicy: Never`, `backoffLimit: 0`, `ttlSecondsAfterFinished: 60` so the Job and its pod are garbage-collected shortly after the turn ends. The agent-runtime exits when the ACP connection closes. If the hosting node is drained or the pod dies mid-turn, the Job fails without retry; the relay posts an error to Slack (see Consequences). Retrying mid-conversation would risk double-executing side effects (PRs, comments) under two different pod instances.
- **Addressability**: the API server connects to the Job pod by pod IP (looked up via the Kubernetes API after the pod becomes Ready). No Service is needed — the connection is single-consumer, single-producer, for the lifetime of the turn.

### 4. Credential provisioning for foreign users — inline, no Secret

The main pod gets its OneCLI access token from a long-lived per-agent Secret because its pod is long-lived. Forked Jobs are ephemeral (`ttlSecondsAfterFinished: 60`), so the token does not need K8s-level persistence.

Registration is **lazy** — on first turn from a given `(agent, foreignSub)` pair, not at `/humr login` time. Eager registration would have to fan out across every humr-agent for every linked user (Slack logins are not instance-scoped), which scales as `users × agents` and produces dead registrations for users who never reply in a given thread. The lazy cost — one RFC 8693 exchange plus one `CreateAgent` round-trip — is paid once per `(user, agent)` across the user's lifetime and amortizes to zero.

On Job creation:

- The controller uses the existing `factory.ClientForOwner(foreignSub)` (RFC 8693 impersonation) to obtain a OneCLI client scoped to the foreign user.
- Registers the agent under that user in OneCLI. The Go client's `CreateAgent` is idempotent over the `(user, identifier)` tuple: OneCLI returns `409 Conflict` on duplicate, and the client falls back to `listAgents` + `findByIdentifier` to return the existing agent with its original access token (`client.go:157-159`). First turn from a user registers; subsequent turns return the same token.
- Inlines the resulting token directly into the Job's `env[]` as `ONECLI_ACCESS_TOKEN`. The pod's `HTTPS_PROXY` interpolation (`http://x:$(ONECLI_ACCESS_TOKEN)@gateway:port`) works identically.
- Keeps an in-memory cache of `(agent, foreignSub) → accessToken` in the controller to avoid the two HTTP round-trips (POST-409 + GET list) that `CreateAgent` otherwise pays on every turn. Cache miss on controller restart is fine — the next turn re-mints via the 409 path and re-caches.
- Cache semantics: no TTL (OneCLI access tokens have no server-side expiry; they are API-key-like strings), no size bound (cardinality is `|agents| × |foreign users who touched them|` — bounded by team size, not turn rate). Evict on `allowedUsers` removal (controller already reconciles instance ConfigMaps; when a sub is removed, drop the matching cache entry). Keycloak-side revocation has no direct signal and needs none — the next fork attempt safe-fails at `factory.ClientForOwner(sub)` during token exchange, before the cache is even consulted.

Why no K8s Secret:

- RBAC separation between Jobs and Secrets is weak — operators with `get jobs` typically also have `get secrets`; it is not a real trust boundary in our threat model.
- A Job-spec-inlined token exists only for the Job's lifetime (plus TTL); a Secret would outlive every individual turn and accumulate cruft on user revocation.
- DNS-1123 naming constraints, GC lifecycle, and a separate reconciliation loop are avoided.

OneCLI is unchanged — no new delegation header, no `act_as` semantics; the existing per-user agent registration model is sufficient.

### 5. Relay routing — API server requests a fork via a ConfigMap, controller reconciles

Fork-Job requests follow the existing ConfigMap-as-IPC pattern (agent-template, agent-instance, agent-schedule): the API server writes `spec.yaml`, the controller reconciles and writes `status.yaml`. No new tRPC endpoints, no direct API-server-to-controller calls.

New ConfigMap type: `humr.ai/type: agent-fork`.

- **`spec.yaml`** (API-server-owned): `{ instance, foreignSub, sessionId? }` — identifies the instance to fork off, the foreign user whose credentials bake into the Job, and optionally the ACP session to resume.
- **`status.yaml`** (controller-owned): `{ phase: Pending|Ready|Failed|Completed, jobName, podIP, error? }` — reports Job progress and the pod address once reachable.

The API server's Slack relay, before calling `sendPrompt`:

1. Resolves the replier's `keycloakSub` from the Slack event.
2. If `keycloakSub == instance.owner`, opens an ACP connection to the main pod (current behavior).
3. Otherwise:
   a. Creates an `agent-fork` ConfigMap with `spec.yaml`.
   b. Watches the ConfigMap (informer) until `status.yaml.phase == Ready`, then reads `status.yaml.podIP`.
   c. Opens an ACP connection to `podIP:8080` and relays the turn.
   d. On turn completion (ACP session closed or timeout), deletes the ConfigMap; controller's owner-reference cleanup removes the Job.

The controller's fork reconciler, watching `agent-fork` ConfigMaps:

1. Ensures the foreign user's OneCLI registration exists (§4) and mints the access token (in-memory cache hit or 409 fallback).
2. Creates the Job with the instance's RWX PVC, CA-cert init container, and the inlined `ONECLI_ACCESS_TOKEN`.
3. Watches the Job's pod; once Ready with an IP, writes `status.yaml` with `phase: Ready` + `podIP`.
4. On fork ConfigMap deletion, the Job is garbage-collected via owner reference.

Session resumption works identically in both branches: the same `sessionId` in the `sessions` table (ADR-019) is passed to `unstable_resumeSession`, and the session state is read from the shared PVC.

### 6. Access control unchanged

ADR-018's two-tier gate (channel membership + per-instance allowed users) still runs against the replier's identity, as today. Impersonation piggybacks on the existing identity resolution — no new auth path.

### 7. Concurrency — explicitly deferred

The main pod and a fork Job could, in principle, run turns simultaneously (Alice uses the UI while Bob replies on Slack). Two processes writing to the same git working tree, the same `~/.claude` transcripts, and the same dependency caches can corrupt state.

For now: concurrency is out of scope. We accept the possibility of races until usage patterns show they matter. A follow-up ADR will introduce turn serialization (per-instance lock, queue, or leader election).

### 8. Non-Slack surfaces unaffected

Direct UI sessions, cron-triggered sessions (ADR-019), and MCP/harness-API traffic continue to use the instance owner's identity in the main pod. Per-turn forking is a Slack-channel-specific behavior because Slack is the only surface where multiple authenticated identities can drive the same instance.

## Alternatives Considered

**ACP `_meta` api-key swap (the original draft).** Rejected — not implementable. The OneCLI token is baked into `HTTPS_PROXY` at pod startup; the agent's child processes inherit the frozen env var. No runtime hook exists to redirect outbound traffic per turn.

**Sidecar HTTP proxy per pod that rewrites identity per turn.** A local proxy inside the pod forwards to the OneCLI gateway with a per-turn token selected by agent-runtime. Rejected: the sidecar would need to know turn boundaries (a new control channel), shares process/filesystem scope with the main pod (no credential isolation for real), and concurrent turns on the same pod would clash. The Jobs approach gives cleaner isolation at the K8s boundary.

**OneCLI `act_as` / delegation header.** API server sends its own token plus an `act_as: <sub>` header; OneCLI fork honors it for trusted callers. Rejected: adds a new trust boundary and delegation semantics in the OneCLI fork; the Jobs approach achieves the same outcome with unmodified OneCLI.

**Per-replier instance (fork the full instance on first foreign reply).** Each Slack user gets their own long-lived instance when they join a thread. Rejected: fragments the conversation across instances, explodes instance count, and defeats the shared-workspace value of threading. Jobs give us the same credential isolation without the long-lived fragmentation.

**Do nothing — instance owner is close enough.** Rejected: silently attributes actions to the wrong user and breaks on the first real team use case (PRs opened as the wrong author, wrong quotas hit, missing scopes).

**Thread-initiator identity as a fallback when the replier is unlinked.** Rejected: violates the principle that actions are attributed to whoever requested them. ADR-018 already requires identity linking; unlinked users are rejected at the relay, not silently impersonating someone else.

## Consequences

- Outbound API calls in a foreign-user Slack turn are attributed to the actual replier; PRs, issues, model usage, audit logs all match who asked for the action.
- Owner turns stay on the main pod — no regression in latency or behavior for the 80% case.
- Every Humr deployment must provision an RWX-capable storage class. The dev cluster (k3s-on-lima) ships with a workaround; prod deployments on managed K8s (EKS, GKE, AKS) already have RWX via EFS/Filestore/Azure Files.
- The controller grows a `(agent, foreignSub) → accessToken` in-memory cache and a new fork-Job creation path. No new persistent K8s resources (no per-foreign-user Secret).
- The API server gains a "fork path" in the Slack relay: detect foreign replier → create `agent-fork` ConfigMap → watch until `status.yaml.phase == Ready` → proxy ACP to `status.yaml.podIP`. Job creation + pod Ready adds ~2–5s cold-start latency per foreign turn; acceptable for Slack.
- A new ConfigMap type `humr.ai/type: agent-fork` is introduced, reusing the existing spec/status split and informer machinery. No new CRDs or tRPC endpoints.
- OneCLI is unchanged — no new headers, no delegation flow; the fork burden from ADR-015 does not grow.
- Shared workspace means Bob's Job and Alice's pod see the same `.git`, same `node_modules`, same `~/.claude`. Races are possible but deferred (§7).
- Jobs auto-clean (`ttlSecondsAfterFinished`). No long-running state — credentials are inlined into the Job env and die with the Job; only the controller's in-memory cache persists between turns.
- Non-Slack surfaces (UI, schedules, MCP) are unaffected and continue to run as the instance owner.
- Unlinked Slack repliers continue to be rejected at the relay (ADR-018 §2) — no impersonation fallback.
- Error paths: if Job creation, pod readiness, or credential minting fails for a given turn, the relay posts an ephemeral error to Slack and does not fall back to the instance owner's identity — failing closed is the safe default for credential routing.
