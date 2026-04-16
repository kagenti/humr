# Plan: Job-based runtime (ADR-012 implementation) — v0

**Date:** 2026-04-16
**Status:** Draft — awaiting approval
**ADR:** [012-runtime-lifetime.md](../adrs/012-runtime-lifetime.md)

## Summary

Replace StatefulSet-based agent pods with single-use Kubernetes Jobs. Each conversation turn spawns a new Job that runs to completion. The workspace is preserved across turns via a persistent volume.

This is a **v0 prototype** to prove viability. No migration of existing data, no backwards compatibility, no cron/trigger support. The goal is: message in → Job starts → agent responds → Job dies → state survives → next message works.

## Current state

- Controller creates a **StatefulSet** (replicas=0 or 1) + headless **Service** + **NetworkPolicy** per instance
- Pods are long-lived; hibernation = scale to 0, wake = scale to 1
- API server discovers pods via static DNS: `{instance}-0.{instance}.{ns}.svc:8080`
- Scheduler delivers triggers via `kubectl exec` into the running pod
- IdleChecker probes `/api/status` and hibernates idle pods
- Agent-runtime runs a persistent WebSocket server; trigger-watcher polls a directory

## Design

### Core model change

| Concept | StatefulSet model | Job model |
|---------|------------------|-----------|
| Lifecycle | Long-lived pod, scale 0/1 | One Job per turn, runs to completion |
| Instance states | `running` / `hibernated` | `idle` (no pod) / `active` (Job running) |
| Pod discovery | Static DNS via headless Service | API server watches Job's pod directly |
| ACP connection | API server → persistent WebSocket | API server → WebSocket to Job pod, lifetime = one turn |
| Idle management | IdleChecker hibernates after timeout | No idle management — Job completes, pod dies |

### Instance state machine

```
idle  ──(new message)──▶  starting  ──(pod ready)──▶  active
  ▲                                                       │
  └──────────────────(Job completes)──────────────────────┘
```

No "hibernated" state. Instances are either idle (no pod) or active (Job running). The `desiredState` field in the instance spec becomes unnecessary.

### Persistent storage

Single PVC per instance, mounted at `/home/agent`. Contains everything: workspace (git checkout, node_modules, .venv, build artifacts), agent memory, SOUL.md, learned preferences. Matches the current model — all persistent state lives under the home directory.

The PVC is created eagerly when the instance is first reconciled (not via VolumeClaimTemplates, since Jobs don't support them). Deleted when the instance is deleted, same as today. Ephemeral mounts (e.g., `/tmp`) remain emptyDir.

### v0 scope decisions

**API server creates Jobs directly.** The controller does not participate in per-turn Job creation. This avoids the annotation-based coordination protocol (`run-request` → controller → `pod-ip`) and keeps the v0 simple. The API server reads the agent ConfigMap for image/env/mounts and builds a simplified Job spec in TypeScript.

**No cron/trigger support.** Scheduler, trigger-watcher, `HUMR_TRIGGER` env var — all deferred. Interactive turns only. The scheduler code can stay in the codebase; it just won't work (no running pods to exec into).

**No agent-runtime changes.** The server already exits when the WebSocket closes and the child process dies. That's the right behavior — the Job container completes naturally. No explicit shutdown logic needed.

**No Job reaper.** `ttlSecondsAfterFinished` handles cleanup of completed Jobs. Stuck Jobs are dealt with manually during prototyping.

### Deferred to post-v0

- Cron/scheduled triggers (requires trigger delivery rethink)
- Annotation-based coordination (controller as sole Job creator)
- Graceful shutdown / idle timeout in agent-runtime
- Job reaper for stuck Jobs
- UI state label updates (`idle`/`active` instead of `running`/`hibernated`)

---

### Component changes

#### 1. Controller — `packages/controller/`

The controller's role shrinks to **infrastructure provisioning**: PVCs and NetworkPolicies. It no longer creates or manages workloads (StatefulSets or Jobs).

##### 1a. Resource builders (`pkg/reconciler/resources.go`)

- **Delete** `BuildStatefulSet()`.
- **Delete** `BuildService()`.
- **Add** `BuildPVCs()` — creates PVCs (one per persistent mount, typically just `/home/agent`) with owner references to the instance ConfigMap. Uses the same 10Gi / ReadWriteOnce as the current VolumeClaimTemplates.
- **Keep** `BuildNetworkPolicy()` unchanged — it already selects pods by `humr.ai/instance` label, which works for Job pods too.

##### 1b. Instance reconciler (`pkg/reconciler/instance.go`)

- **On reconcile**: Ensure PVCs exist, ensure NetworkPolicy exists. That's it.
- **On delete**: Delete PVCs (already done today). NetworkPolicy cascade-deletes via owner reference.
- **Delete** `applyStatefulSet()`, `applyService()`.
- **Add** `applyPVCs()` — idempotent PVC creation (create-if-not-exists, same pattern as current `applyService`).
- **Instance status**: For v0, keep writing status as today but with state `idle` (no meaningful `running`/`hibernated` distinction since there's no StatefulSet to scale).

##### 1c. Idle checker (`pkg/reconciler/idlechecker.go`)

**Delete entirely.** No idle state to manage.

##### 1d. Scheduler (`pkg/scheduler/scheduler.go`)

**Leave as-is for v0.** It will fail to exec into pods (no StatefulSet pod `{instance}-0` exists), but that's expected — cron is out of scope.

##### 1e. RBAC changes (`deploy/helm/humr/templates/controller/rbac.yaml`)

- **Remove** `apps/statefulsets` permissions.
- No new permissions needed — the controller doesn't create Jobs in v0.

##### 1f. Types (`pkg/types/types.go`)

- **Remove** `desiredState` validation requiring `running`/`hibernated`. For v0, the field can remain in the spec YAML but is ignored by the controller. The reconciler no longer branches on it.

##### 1g. Config (`pkg/config/config.go`)

- **Remove** `IdleTimeout` (idle checker is deleted).

##### 1h. Main (`main.go`)

- **Remove** idle checker goroutine (`go idleChecker.RunLoop(ctx)`).

---

#### 2. API Server — `packages/api-server/`

The API server takes on **Job creation and pod discovery** — the main new responsibility.

##### 2a. K8s client (`src/modules/agents/infrastructure/k8s.ts`)

- **Add** `BatchV1Api` client for creating/reading Jobs.
- **Add** `createJob(job)` — creates a Job in the agent namespace.
- **Add** `getJobPod(jobName)` — lists pods by `job-name={jobName}` label selector, returns the pod (Jobs create exactly one pod when `backoffLimit=0`).
- **Remove** `podBaseUrl()` (static DNS function). Replace with pod-IP-based URL construction.

##### 2b. Job spec builder (new: `src/modules/agents/infrastructure/job-builder.ts`)

New module that builds a `batchv1.Job` manifest. Reads the agent ConfigMap (image, mounts, env, init, resources) and instance ConfigMap (env overrides, secretRef), produces a Job spec.

Simplified compared to the Go `BuildStatefulSet()`:
- Same env var merging (platform + agent + instance)
- Same volume setup: PVC references for persistent mounts, emptyDir for ephemeral, emptyDir + init container for CA cert
- Same init containers (CA cert fetch + optional user init)
- Same security context, resources, image pull config
- `backoffLimit: 0`, `ttlSecondsAfterFinished: 300`, `activeDeadlineSeconds: 1800`
- Labels: `humr.ai/instance={instanceId}` (for NetworkPolicy to match)
- `restartPolicy: Never` (required for Jobs)

The Job spec builder reads platform config (OneCLI gateway address, CA cert init image, etc.) from environment variables available to the API server. Some of these are currently only in the controller's config — they need to be added to the API server's Helm deployment env.

##### 2c. ACP relay (`src/acp-relay.ts`)

Rework the connection flow:

1. Client WebSocket connects to API server
2. API server creates a Job via K8s API
3. **Poll for pod readiness**: List pods by Job name label, check for `Ready` condition (500ms interval, 120s timeout — same as current `waitForPodReady`)
4. Connect upstream WebSocket to `ws://{podIP}:8080/api/acp`
5. Relay messages bidirectionally (same as today)
6. On client disconnect: nothing special — agent-runtime exits when WebSocket closes, Job completes

Replace `connectUpstream` + `wakeIfHibernated` retry logic with: `createJob` → `waitForPodReady` → `connectUpstream`.

Remove `ACTIVE_SESSION_KEY` and `LAST_ACTIVITY_KEY` annotation management — no idle checker to consume them.

##### 2d. Instance repository (`src/modules/agents/infrastructure/InstancesRepository.ts`)

- **Remove** `wakeIfHibernated()`, `isPodReady()`, `wake()`.
- **Remove** `patchAnnotation()` calls for active-session / last-activity.
- **Update** `get()` — no longer reads pod `{id}-0`. Instance state is always effectively "idle" from the ConfigMap's perspective; active state is transient (Job exists or doesn't).
- **Update** `list()` — no longer joins pods by label. Pod state is irrelevant to instance listing.

##### 2e. tRPC relay (`src/trpc-relay.ts`)

For v0, return 503 "instance idle" if no active Job pod exists. The tRPC relay is used for the file browser — it only works while a turn is active. This is acceptable for a prototype.

##### 2f. Trigger handler (`POST /internal/trigger`)

**No changes for v0.** The endpoint still exists but won't be called (no trigger-watcher running, no cron creating Jobs). Left as dead code.

---

#### 3. Agent Runtime — `packages/agent-runtime/`

**No changes for v0.** The existing behavior is already correct:

- Server starts, listens for WebSocket connections on `/api/acp`
- On connection: spawns ACP child process, relays messages
- On WebSocket close: kills child process
- Child process exits → WebSocket closes → no more connections → server has nothing to do
- Job's `activeDeadlineSeconds` ensures the container doesn't run forever if something hangs

The trigger-watcher will start and find no trigger files (the triggers directory is empty or doesn't exist). It polls harmlessly.

---

#### 4. Helm Chart — `deploy/helm/humr/`

##### 4a. Controller RBAC

Remove `apps/statefulsets` permissions. No additions needed.

##### 4b. API Server RBAC (new)

The API server needs K8s permissions to create Jobs and read pods. Currently it only has ConfigMap/Pod access via a shared ServiceAccount or in-cluster config. Add:

```yaml
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["create", "get", "list", "watch", "delete"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
```

Check if the API server already has a dedicated ServiceAccount or uses the controller's. If it uses the default ServiceAccount, create one with the needed permissions.

##### 4c. API Server deployment env

Add env vars the Job builder needs (currently only in controller):
- `ONECLI_GATEWAY_HOST`, `ONECLI_GATEWAY_PORT`, `ONECLI_WEB_PORT` (for proxy URL and CA cert init)
- `CA_CERT_INIT_IMAGE` (default: `busybox:stable`)
- `AGENT_IMAGE_PULL_POLICY`, `AGENT_IMAGE_PULL_SECRETS`
- `HUMR_JOB_ACTIVE_DEADLINE` (default: 1800)
- `HUMR_JOB_TTL_AFTER_FINISHED` (default: 300)

##### 4d. Controller deployment env

Remove `HUMR_IDLE_TIMEOUT`.

---

#### 5. UI — `packages/ui/`

**No changes for v0.** The WebSocket connection from the UI to the API server is unchanged. The API server handles the Job lifecycle transparently. The UI may see slightly longer initial connection times (Job startup) but the existing "connecting..." state handles this.

---

## Implementation order

### Phase 1: Controller — strip down to PVC + NetworkPolicy
1. Delete `idlechecker.go`
2. Remove idle checker goroutine from `main.go`
3. Remove `IdleTimeout` from `config.go`
4. Delete `BuildStatefulSet()`, `BuildService()` from `resources.go`
5. Add `BuildPVCs()` to `resources.go`
6. Rewrite `instance.go` reconciler: `applyPVCs()` + `applyNetworkPolicy()` only; delete `applyStatefulSet()`, `applyService()`
7. Relax `desiredState` validation in `types.go`
8. Update RBAC in Helm chart (remove `apps/statefulsets`)

### Phase 2: API Server — Job creation & pod discovery
1. Add `BatchV1Api` to `k8s.ts`; add `createJob()`, `getJobPod()` helpers
2. Create `job-builder.ts` — reads agent/instance ConfigMaps, builds Job spec
3. Rewrite `acp-relay.ts`: create Job → poll pod ready → connect via pod IP
4. Update `InstancesRepository.ts`: remove wake/hibernate/pod methods
5. Update Helm chart: API server RBAC + new env vars
6. Update tRPC relay to return 503 when no active pod

### Phase 3: Integration testing
1. Deploy to local k3s cluster
2. Test: send message → Job created → agent responds → Job completes
3. Test: send follow-up message → new Job → workspace state persisted
4. Test: concurrent message while Job running → verify behavior (expect failure or queueing)
5. Verify PVC lifecycle: create instance → PVC created; delete instance → PVC deleted

## Open questions

1. **Concurrent turns**: What if a new message arrives while a Job is still running? For v0: **reject with "instance busy"** — the API server checks for an existing active Job before creating a new one.

2. **API server RBAC**: Does the API server already have a ServiceAccount with pod/configmap access, or does it use the default? Need to check before adding Job permissions.

3. **Job naming**: Jobs need unique names. Candidate: `{instanceId}-{timestamp}` or `{instanceId}-{shortUUID}`. Must be DNS-safe and ≤63 chars.

4. **Platform env vars in API server**: The Job builder needs OneCLI gateway config, image pull config, etc. These are currently only injected into the controller. Need to thread them through the API server's Helm deployment.

5. **Session continuity**: Claude Code persists conversation history to the workspace (`/home/agent`). The `--continue` flag or session resumption should work across Jobs since the PVC survives. Needs verification.

## Files to modify

| File | Action |
|------|--------|
| `packages/controller/pkg/reconciler/resources.go` | Delete `BuildStatefulSet`, `BuildService`; add `BuildPVCs` |
| `packages/controller/pkg/reconciler/instance.go` | Rewrite: PVC + NetworkPolicy only |
| `packages/controller/pkg/reconciler/idlechecker.go` | **Delete file** |
| `packages/controller/pkg/types/types.go` | Relax `desiredState` validation |
| `packages/controller/pkg/config/config.go` | Remove `IdleTimeout` |
| `packages/controller/main.go` | Remove idle checker startup |
| `packages/api-server/src/acp-relay.ts` | Rewrite: Job creation → pod IP → connect |
| `packages/api-server/src/modules/agents/infrastructure/k8s.ts` | Add BatchV1Api, Job/Pod helpers; remove `podBaseUrl` |
| `packages/api-server/src/modules/agents/infrastructure/job-builder.ts` | **New file**: Job spec builder |
| `packages/api-server/src/modules/agents/infrastructure/InstancesRepository.ts` | Remove wake/hibernate/pod methods |
| `packages/api-server/src/trpc-relay.ts` | Return 503 when no active pod |
| `deploy/helm/humr/templates/controller/rbac.yaml` | Remove `apps/statefulsets` |
| `deploy/helm/humr/templates/apiserver/rbac.yaml` | **New or update**: add `batch/jobs` + `pods` |
| `deploy/helm/humr/templates/apiserver/app.yaml` | Add platform env vars for Job builder |
| `deploy/helm/humr/templates/controller/deployment.yaml` | Remove `HUMR_IDLE_TIMEOUT` |
| `deploy/helm/humr/values.yaml` | Add Job config defaults, remove idle timeout |
