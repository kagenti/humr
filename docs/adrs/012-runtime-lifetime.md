# ADR-012: Runtime lifetime — single-use Jobs

**Date:** 2026-04-07
**Status:** Accepted
**Owner:** @JanPokorny

## Context

With ephemeral containers (ADR-001), the question is: does the container stay alive between conversation turns, or is it killed after each response and respawned on the next message?

For coding agents (currently the majority of use cases), the workspace — git repository, `node_modules`, `.venv`, etc. — is persisted on a volume (decided in ADR-001). This means restarting the container between turns is functionally equivalent to `claude --continue` or its equivalent: the process is new, but the working state is intact. The ~2-second startup latency is effectively hidden inside the agent runtime, which runs for significantly longer.

However, agents can also make changes outside the workspace: global tool installs (`npm install -g`, `uv tool install`), edits to system files (`/etc/hosts`), or other OS-level modifications. These changes live in the container's ephemeral filesystem and are lost when the Job completes. The single-use Job model must account for this.

A key observation is that **longer-running pods do not escape the persistence problem — they merely defer it.** No pod runs forever: nodes get recycled, deployments roll, OOM kills happen. Any state that isn't explicitly persisted will eventually be lost regardless of the container's lifetime. The complexity of "how to persist data" is inherent to the problem, not an artifact of the single-use model. Keep-alive buys time, but does not buy correctness.

## Decision

**Kill after each response (single-use Kubernetes Job).**

Each agent turn is a standalone Kubernetes Job that runs to completion and is not reused. This model is used by e.g. [Sympozium](https://github.com/sympozium-ai/sympozium).

Keep-alive with idle timeout (Alternative 1) was considered but rejected as premature optimization at this stage. The added complexity is not justified by the latency savings.

Single-use Jobs avoid three categories of complexity that keep-alive would introduce:

1. **No "is it already running?" check.** Querying the Kubernetes API for pod status has non-trivial latency (~0.5–1s based on experience with Bee Code Interpreter). Always creating a new Job is simpler and avoids that round-trip entirely.

2. **No inactivity detection.** Detecting that an agent has entered an idle state — and doing so reliably in the presence of background tasks — requires bridging application-level protocol information (e.g., ACP traffic) to the platform layer. Every harness can signal process completion, but "idle" is a much harder predicate. Avoiding it removes a whole class of bookkeeping (tracking idle state, running a reaper job, choosing a timeout value).

3. **No lifecycle race conditions.** A keep-alive container can be simultaneously targeted for wake-up (new message arrives) and teardown (idle timeout fires). When these events overlap, edge cases emerge — e.g., the platform opens a connection to a container that is mid-termination. Single-use Jobs have no such races: a Job is either pending, running, or completed.

### Caching layer for lightweight operations

Tomas W. raised a valid concern: switching to single-use Jobs means the agent's ACP conversation state is no longer available in a long-lived process. Spinning up a Kubernetes Job for trivial operations — listing active sessions, querying agent metadata — is wasteful and adds unnecessary latency.

We agreed that the ACP conversation state remains the source of truth for the agent's view of the interaction, but the platform needs a **caching layer** (Redis or equivalent) that serves lightweight read operations without creating a Job. The cache is populated as a side effect of Job execution and is treated as ephemeral — the actual persistence layer is the persistent volumes, which store data in harness-specific formats. If the cache is cold or missing, the platform must spawn a Job to retrieve the data via ACP — the platform makes no assumptions about harness-internal storage formats and does not read volumes directly.

### Two tiers of persistent storage

Agent Job pods mount **two tiers** of persistent storage:

1. **Per-session volume** — the current workspace: git checkout, `node_modules`, `.venv`, build artifacts, and any session-specific state. This is what ADR-001 already describes. Scoped to a single conversation/session and not shared.

2. **Shared volume** — state that spans all sessions for a given agent: Claude memory, `SOUL.md`, learned preferences, accumulated knowledge, and any other self-evolution artifacts. This volume is mounted read-write and is accessible from every Job the agent runs, regardless of session.

Tomas W. argues — and we agreed — that the shared tier is essential to differentiate the project from "Claude Code for Web," which starts as a clean slate on every session and does not support self-evolution. The shared tier makes agents stateful across sessions in the way OpenClaw envisions: an agent that remembers, learns, and accumulates context over its lifetime.

The boundary between tiers is enforced by mount paths. The harness is responsible for reading/writing to the correct tier. Specifics of the mount layout (e.g., `/workspace` vs. `/shared`) will be defined in a follow-up.

### Handling changes outside the workspace

Since each Job starts from a clean container image, changes agents make outside the persisted workspace require explicit handling:

**Global tool installs** — Persist `$HOME` on the volume (or at minimum the global install locations: `~/.npm-global`, `~/.local/bin`, mise shims, etc.). This makes `npm install -g`, `uv tool install`, and similar commands survive across turns without a full container rebuild.

**Extra tooling via `mise.toml`** — Agents or users can declare additional tools (specific Node versions, Python versions, CLI utilities) in a `mise.toml` at the workspace root. The mise cache directory is persisted on the volume, so tool resolution is instant on subsequent turns — mise only downloads on first use.

**Init scripts** — Users may need a container preparation step that goes beyond what `mise.toml` covers. There are two categories of init work to consider:

- *Persistable changes* (installing global packages, seeding config in `$HOME`, generating caches) write to the persisted volume. These only need to run once: the script drops a marker file (e.g., `.init-done`) on the volume after first successful execution, and subsequent Jobs skip it entirely. Alternatively, this can be modeled as a mise task with install hooks, which has built-in caching and avoids re-execution automatically.
- *Non-persistable changes* (edits to `/etc/hosts`, `/etc/resolv.conf`, sysctl tunables, installing OS packages outside `$HOME`) write to the container's ephemeral filesystem and are lost when the Job completes. Supporting these in init scripts would mean running the script on every turn, adding its execution time to the critical path of every single interaction.

To avoid per-turn init overhead, we restrict init scripts to persistable changes only. OS-level modifications are disallowed by convention and documented in `AGENTS.md`. This is a real downside of single-use Jobs compared to keep-alive (Alternative 1), where such changes would survive naturally for the lifetime of the container. If a use case genuinely requires system-level configuration, the correct path is a custom container image.

## Alternatives Considered

1. **Keep-alive with idle timeout.** Lower latency for rapid back-and-forth conversations, but introduces all three complexity categories above. Tomas W. proposed hooking into ACP traffic with a ~20-minute timeout; while feasible in the prototype, this still requires bridging protocol-level signals to the platform and handling background tasks correctly. Deferred as a future optimization if latency becomes a measurable problem. Keep-alive would also sidestep the pod-level persistence problem entirely (global installs and `/etc/` edits survive as long as the container lives), but — as noted in Context — this is deferral, not a solution. The persistence problem returns when the pod eventually dies.

2. **Configurable per agent.** Most flexible, but adds platform complexity and forces developers to reason about a tradeoff most don't need to make yet. Can be revisited if distinct usage patterns (interactive vs. scheduled) emerge at scale.

## Consequences

- **Startup latency on every turn.** Acceptable for coding agents where task runtime dominates. If short interactive turns become a primary use case, revisit keep-alive (Alternative 1).
- **Simpler lifecycle management.** No health checks, no orphan cleanup, no idle-timeout tuning.
- **Stronger isolation.** Each turn gets a clean process; no leaked state between turns.
- **Container startup optimization matters.** Image size, layer caching, and cold-start performance should be tracked as operational metrics. Init script execution time is part of the critical path on first run.
- **Caching layer is a new dependency.** Redis (or equivalent) must be provisioned and maintained. Cache invalidation strategy needs to be defined — likely simple TTL-based expiry with write-through on Job completion.
- **Two-tier storage increases operational surface.** Shared volumes need backup, access control, and size management. The boundary between per-session and shared data must be well-documented so harness authors use the correct tier.
- **Persisted `$HOME` and mise cache increase volume size.** Global installs and cached tool versions accumulate over time. May need periodic cleanup or size limits.
- **OS-level changes are explicitly unsupported.** This is a deliberate tradeoff documented in `AGENTS.md` to avoid per-turn init script execution. Agents that need system-level customization must use a custom container image. This is a known ergonomic gap compared to keep-alive (Alternative 1).

## Implementation Plan

This ADR is accepted but represents a significant rearchitecture of the current prototype (which uses keep-alive pods). Implementation will proceed on a **parallel track** and is **not a blocker for the initial release.** The current prototype will ship as-is; migration to single-use Jobs will happen incrementally once the caching layer and two-tier storage are in place.

## Appendix: Implementation Notes (2026-04-16)

The Job-based model was implemented as a full replacement of the StatefulSet model. This appendix documents deviations from the ADR and the current state.

### What was implemented

The controller now manages PVCs, NetworkPolicies, and Jobs. The API server coordinates via annotations on the instance ConfigMap:

1. API server sets `humr.ai/run-request` annotation
2. Controller's informer fires, creates a Job, writes `humr.ai/active-job` + `humr.ai/pod-ip`
3. API server polls for `humr.ai/pod-ip`, connects upstream WebSocket
4. When the Job finishes, controller clears annotations and sets status to `idle`

Cron triggers use the same annotation flow: the scheduler sets `humr.ai/run-request` + `humr.ai/trigger` (JSON payload). The controller passes the trigger as a `HUMR_TRIGGER` env var on the Job pod. The agent-runtime reads it on startup.

Idle checker, StatefulSet/Service creation, hibernation/wake lifecycle, and `kubectl exec` trigger delivery were all removed.

### Deviation: Job reuse within a turn

The ADR says "always creating a new Job" (section 1 — no "is it already running?" check). The implementation does check for an active Job and reuses it: if a second WebSocket connection arrives while a Job is running, it connects to the existing pod rather than creating a new Job. This is a pragmatic choice — the agent-runtime supports multiple concurrent WebSocket sessions (e.g., trigger + interactive), and the `activeDeadlineSeconds` safety net ensures Jobs don't run forever.

Truly single-use "one Job per message" would require the agent-runtime to exit after each ACP session completes and the API server to create a fresh Job for every message. This can be revisited if stronger isolation between turns is needed.

### Deviation: Single PVC instead of two-tier storage

The ADR specifies per-session and shared volumes. The implementation uses a single PVC mounted at `/home/agent` that contains everything: workspace, agent memory, SOUL.md, learned preferences. This matches the existing home-directory-based persistence model and avoids the operational complexity of managing two volumes per instance. The two-tier split can be introduced later if cross-session shared state needs explicit separation from workspace state.

### Deviation: No caching layer

The ADR calls for Redis or equivalent to serve lightweight read operations (session listing, agent metadata) without spinning up a Job. This is not yet implemented — the tRPC relay returns 503 when no Job pod is active, and session listing requires an active pod. For now, the DB-backed session table in the API server provides basic session history without needing a running pod. A caching layer remains a future optimization for when the cost of cold reads becomes measurable.

### Persistence conventions

Agent pods start from a clean container image on every turn. Only `/home/agent` (the PVC) survives between turns. Everything else — `/tmp`, OS packages, system files — is ephemeral.

Global tool installs should target the home directory (e.g., `pip install --user`, `cargo install`). In the future, `mise.toml` at the workspace root is the preferred mechanism — mise caches tools under `~/.local/share/mise` which lives on the persistent volume, making tool resolution instant on subsequent turns.

These conventions should be communicated to the agent harness. For Claude Code agents, this means including them in the `CLAUDE.md` baked into the agent image. Example:

```markdown
## Runtime environment

You are running inside an ephemeral container. A new container is created for
each conversation turn — no process state carries over.

### What persists (between turns)

`/home/agent` is backed by a persistent volume. Everything under this path
survives: workspace files, git checkouts, node_modules, .venv, tool caches,
your memory files, and configuration.

### What does NOT persist

- OS packages installed via `apt`, `dnf`, etc.
- Edits to `/etc/hosts`, `/etc/resolv.conf`, or other system files.
- Anything in `/tmp` or outside `/home/agent`.

If you need a tool that isn't in the base image, prefer installing it under
your home directory (e.g., `pip install --user`, `cargo install`) or declaring
it in a `mise.toml` at the workspace root.
```
