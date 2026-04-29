# DRAFT: App-owned scheduling — Postgres-backed schedules fired by api-server

**Date:** 2026-04-28
**Status:** Proposed
**Owner:** @tomkis

## Context

Schedules in Humr today are K8s-native: each user-created schedule is an `agent-schedule` ConfigMap with `humr.ai/type=agent-schedule`. The Go controller watches these ConfigMaps, runs a per-schedule goroutine that walks RRULE occurrences with quiet hours, wakes the target instance, and delivers the trigger via `kubectl exec` writing `/home/agent/.triggers/{ts}.json` ([ADR-008](008-trigger-files.md), [ADR-031](031-schedule-rrule-quiet-hours.md)).

This shape was inherited from [ADR-006](006-configmaps-over-crds.md): "everything is a ConfigMap so Humr installs without cluster-admin." That rationale is load-bearing for `agent-instance` (the controller materializes pods from it), but it is **not** load-bearing for `agent-schedule` — schedules don't materialize K8s objects, they poke existing pods. We adopted the ConfigMap pattern uniformly for symmetry, and the cost has accumulated:

- **RRULE math lives in two languages.** The api-server already needs a TS RRULE implementation to render "next fires" in the UI; the controller has its own Go implementation that fires for real. Two implementations, one source of truth — guaranteed drift surface, and the schedule-RRULE-quiet-hours semantics in [ADR-031](031-schedule-rrule-quiet-hours.md) are non-trivial enough that drift is likely.
- **Schedules can't JOIN with anything.** Schedule↔session linkage lives across two stores: `agent-schedule.status.yaml` references `sessionId`, while `sessions` is a Postgres table ([ADR-017](017-db-backed-sessions.md)). Owner filtering, allow-list awareness, and audit trails for schedules are all api-server concerns sitting on the wrong side of a K8s/Postgres boundary.
- **`kubectl exec` is a privileged trigger path.** The controller needs `pods/exec` RBAC purely for trigger delivery. Trigger files give us "durable at-least-once via PVC" almost for free, but at the cost of a pod-pierce capability that nothing else in the platform needs.
- **Status plumbing is awkward.** Schedule next-fire / last-error has to flow controller → `status.yaml` → api-server read → UI render. Edits go the other direction through `spec.yaml`. Both paths are eventual via the K8s watch.
- **Two-language ownership of one concept.** Schedules are user-created, owner-scoped, allow-list-aware domain objects. The api-server owns identity, owner labels, and tRPC validation; the controller fires. Splitting domain ownership across processes raises the cost of every schedule-shaped feature (e.g., "preview the next 10 fires," "skip the next fire," "bulk-edit quiet hours").

The recently-landed centralized pod-reachability primitive ([ADR-032](032-pod-reachability-primitive.md)) removes one of the historical reasons schedule firing had to live next to the StatefulSet reconciler: wake is now a callable primitive in both Go and TypeScript with identical semantics. Any process that can reach the K8s API can wake a pod safely.

## Decision

**Schedules become a Postgres-backed domain resource owned by the api-server. The api-server fires them. The controller stops watching `agent-schedule` ConfigMaps.**

Concretely:

- **Storage.** A new `schedules` Postgres table holds `{ id, owner, instance_id, rrule, quiet_hours, tzid, mode, payload, created_at, updated_at }`. The api-server is the sole writer, owner-filtered like every other api-server resource. `agent-schedule` ConfigMaps are removed from the resource model.
- **Firing.** A single api-server replica holds a Postgres advisory lock and runs the schedule loop: pull due schedules, walk RRULE/quiet-hours in TS (the existing UI preview library), enqueue fires into a `schedule_fires` outbox table. Other replicas idle on the lock; on leader loss, the next replica picks it up. No K8s leader election.
- **Trigger delivery.** Replaces `kubectl exec → trigger file` with `api-server → harness port HTTP POST` (the harness port already accepts trigger receipt — see [ADR-022](022-harness-api-server.md)). The agent-runtime processes the POST identically to a trigger-file pickup. Wake is via the existing reachability primitive in the api-server ([ADR-032](032-pod-reachability-primitive.md)).
- **Durability.** The `schedule_fires` outbox row is written before delivery and acked on harness 2xx. Unacked rows retry with backoff. This replaces the PVC-based at-least-once that the trigger file gave us "for free" with explicit at-least-once in Postgres — at-least-once semantics are preserved, the substrate moves from a per-pod filesystem to the platform DB.
- **Status.** Schedule status (`nextFire`, `lastFire`, `lastError`) becomes a column on the `schedules` table. The ConfigMap `status.yaml` round-trip is gone.
- **Controller.** Loses the schedule reconciler, the cron loop, the RRULE library, and the `pods/exec` reliance for trigger delivery. Keeps everything else: `agent`, `agent-instance`, `agent-fork` reconcilers; pod/StatefulSet/Service/NetworkPolicy/Secret materialization; idle checker; reachability primitive.
- **Migration.** A one-shot `agent-schedule` → Postgres backfill, then deletion of the ConfigMaps and the controller-side reconciler. Interactive triggers (the `pi-agent` flow that also drops trigger files) keep working — they're not on the schedule path and the trigger-file mechanism stays functional.

This supersedes [ADR-008](008-trigger-files.md) for the *scheduled* trigger path. ADR-008's "trigger files in `/home/agent/.triggers/`" mechanism remains valid for any non-scheduled trigger source that wants the file-based contract; the supersession is scoped to "controller-owned cron + exec-based delivery."

## Alternatives Considered

**Keep schedules in the controller, add a shared RRULE package.** Pull the RRULE math into a `packages/schedule-core/` shared between Go and TS so the firer and the UI preview compute the same thing. Cheaper migration; doesn't address the JOIN problem, the `pods/exec` reliance, the cross-process status plumbing, or the two-language ownership split. A point fix, not a refactor.

**Move schedules to the api-server but keep ConfigMaps as the substrate.** API-server reads/writes `agent-schedule` ConfigMaps directly, runs its own RRULE loop. Removes the controller dependency but keeps all the ConfigMap-as-DB problems (no JOIN, no schema, awkward edit semantics). No clear advantage over going to Postgres.

**External job queue (BullMQ + Redis, Temporal, etc.).** Stand up a real workflow engine. Rejected for proportionality: schedules in Humr are a few dozen per install, low frequency, low fan-out. Postgres advisory locks + an outbox table is the smallest tool that matches the problem. Adding Redis or Temporal expands the install surface for no proportionate gain.

**K8s CronJobs.** Out of scope — would put scheduling back into K8s under a different label, and CronJobs don't have the wake/pod-reachability semantics Humr needs. Rejected before this proposal even framed.

## Consequences

**Easier:**

- One language owns RRULE/quiet-hours/timezone semantics (TS).
- Schedule features that need user identity or owner filtering (preview-next-fires-for-user, audit log, allow-list checks) become trivial — they're api-server-local.
- The controller shrinks. Its responsibilities collapse to "reconcile pods/secrets/networkpolicies from instance ConfigMaps" — closer to a textbook operator.
- `pods/exec` RBAC drops out of the controller entirely (the reachability primitive's wake path doesn't need it; only trigger delivery did).
- Schedule edits are immediate (Postgres transaction) instead of eventual (ConfigMap watch).
- Schedule status no longer needs the spec/status split; the same row holds intent and observed.

**Harder:**

- The PVC-based "trigger file as durable inbox" property has to be replaced with an outbox table that the api-server actually retries from. This is standard but is real code that has to be right — at-least-once with retry + dedup at the harness side. Worth dedicated test coverage before flipping.
- Leader election among api-server replicas now matters for schedule firing. Postgres advisory lock is the proposed mechanism; needs an explicit "leader-loss → drop in-flight fires for restart-recovery" story.
- Migration cost: backfilling existing `agent-schedule` ConfigMaps into the new table, with rollback if the rollout regresses. Bounded but non-trivial.
- The controller's NetworkPolicy invariant ("api-server pods can reach the harness port") becomes load-bearing for schedule firing, not just MCP/trigger receipt. It's already in place; just worth flagging that the NP is now the spine of trigger delivery.
- Architecture pages need updates: `agent-lifecycle.md` (Trigger fire section), `persistence.md` (substrate table — schedules move from ConfigMap to Postgres), `platform-topology.md` (controller responsibilities shrink, ConfigMap types table loses `agent-schedule`).
- ADR-006's "ConfigMaps over CRDs" rationale needs revisiting in spirit — not invalidated, but the symmetry argument ("everything is a ConfigMap") weakens once schedules step out. Worth a follow-up note clarifying the rationale applies to *resources that materialize K8s objects*, not domain state in general.
