# DRAFT: Runtime lifetime — keep-alive vs. kill after response

**Date:** 2026-04-02
**Status:** Proposed
**Owner:** @JanPokorny

## Context

With ephemeral containers (ADR-001), the question is: does the container stay alive between conversation turns, or is it killed after each response and respawned on the next message?

Tomas W. is concerned about 2-second startup latency for short conversations if the container restarts each time. Jan Pokorny argues the default should be keep-alive (easier than explicit termination).

This is the same stateful-vs-stateless tension from ADR-001 at a different layer — not about filesystem persistence (decided: workspace volumes) but about process lifetime.

## Decision

TBD. Options under consideration:

**Option A: Keep-alive with idle timeout.** Container stays alive between turns. Killed after N minutes of inactivity (e.g., 10 min). Respawned on next message. Optimizes for interactive conversations at the cost of resource usage.

**Option B: Kill after each response.** Container dies after every turn. Workspace persists via volume. Optimizes for isolation and resource efficiency at the cost of latency.

**Option C: Configurable per agent.** Interactive agents use keep-alive. Scheduled/heartbeat agents use kill-after-response. Different use cases get different defaults.

## Alternatives Considered

See options above — no decision yet.

## Consequences

**If keep-alive:** Lower latency for interactive use. Higher resource usage (idle containers). More complex lifecycle management (timeouts, health checks, orphan cleanup).

**If kill-after-response:** Stronger isolation guarantees. Higher latency on each turn. Simpler lifecycle (no state to manage between turns). Container startup optimization becomes critical.

**If configurable:** Most flexible but adds complexity to the platform. Developers must understand the tradeoff and choose.
