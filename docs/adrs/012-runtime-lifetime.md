# ADR-012: Runtime lifetime — single-use Jobs

**Date:** 2026-04-07
**Status:** Accepted
**Owner:** @JanPokorny

## Context

With ephemeral containers (ADR-001), the question is: does the container stay alive between conversation turns, or is it killed after each response and respawned on the next message?

For coding agents (currently the majority of use cases), the workspace — git repository, `node_modules`, `.venv`, etc. — is persisted on a volume (decided in ADR-001). This means restarting the container between turns is functionally equivalent to `claude --continue` or its equivalent: the process is new, but the working state is intact. The ~2-second startup latency is effectively hidden inside the agent runtime, which runs for significantly longer.

## Decision

**Kill after each response (single-use Kubernetes Job).**

Each agent turn is a standalone Kubernetes Job that runs to completion and is not reused. This model is used by e.g. [Sympozium](https://github.com/sympozium-ai/sympozium).

Keep-alive with idle timeout (Alternative 1) was considered but rejected as premature optimization at this stage. The added complexity is not justified by the latency savings.

Single-use Jobs avoid three categories of complexity that keep-alive would introduce:

1. **No "is it already running?" check.** Querying the Kubernetes API for pod status has non-trivial latency (~0.5–1s based on experience with Bee Code Interpreter). Always creating a new Job is simpler and avoids that round-trip entirely.

2. **No inactivity detection.** Detecting that an agent has entered an idle state — and doing so reliably in the presence of background tasks — requires bridging application-level protocol information (e.g., ACP traffic) to the platform layer. Every harness can signal process completion, but "idle" is a much harder predicate. Avoiding it removes a whole class of bookkeeping (tracking idle state, running a reaper job, choosing a timeout value).

3. **No lifecycle race conditions.** A keep-alive container can be simultaneously targeted for wake-up (new message arrives) and teardown (idle timeout fires). When these events overlap, edge cases emerge — e.g., the platform opens a connection to a container that is mid-termination. Single-use Jobs have no such races: a Job is either pending, running, or completed.

## Alternatives Considered

1. **Keep-alive with idle timeout.** Lower latency for rapid back-and-forth conversations, but introduces all three complexity categories above. Tomas W. proposed hooking into ACP traffic with a ~20-minute timeout; while feasible in the prototype, this still requires bridging protocol-level signals to the platform and handling background tasks correctly. Deferred as a future optimization if latency becomes a measurable problem.

2. **Configurable per agent.** Most flexible, but adds platform complexity and forces developers to reason about a tradeoff most don't need to make yet. Can be revisited if distinct usage patterns (interactive vs. scheduled) emerge at scale.

## Consequences

- **Startup latency on every turn.** Acceptable for coding agents where task runtime dominates. If short interactive turns become a primary use case, revisit keep-alive (Alternative 1).
- **Simpler lifecycle management.** No health checks, no orphan cleanup, no idle-timeout tuning.
- **Stronger isolation.** Each turn gets a clean process; no leaked state between turns.
- **Container startup optimization matters.** Image size, layer caching, and cold-start performance should be tracked as operational metrics.
