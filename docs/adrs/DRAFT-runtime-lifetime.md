# ADR: Runtime lifetime — single-use Jobs

**Date:** 2026-04-07
**Status:** Accepted
**Owner:** @JanPokorny
**Decided with:** Tomas W., Radek J.

## Context

With ephemeral containers (ADR-001), the question is: does the container stay alive between conversation turns, or is it killed after each response and respawned on the next message?

For coding agents (currently the majority of use cases), the workspace — git repository, `node_modules`, `.venv`, etc. — is persisted on a volume (decided in ADR-001). This means restarting the container between turns is functionally equivalent to `claude --continue` or its equivalent: the process is new, but the working state is intact. The ~2-second startup latency is effectively hidden inside the agent runtime, which runs for significantly longer.

However, agents can also make changes outside the workspace: global tool installs (`npm install -g`, `uv tool install`), edits to system files (`/etc/hosts`), or other OS-level modifications. These changes live in the container's ephemeral filesystem and are lost when the Job completes. The single-use Job model must account for this.

## Decision

**Kill after each response (single-use Kubernetes Job).**

Each agent turn is a standalone Kubernetes Job that runs to completion and is not reused. This model is used by e.g. [Sympozium](https://github.com/sympozium-ai/sympozium).

Keep-alive with idle timeout (Alternative 1) was considered but rejected as premature optimization at this stage. The added complexity is not justified by the latency savings.

Single-use Jobs avoid three categories of complexity that keep-alive would introduce:

1. **No "is it already running?" check.** Querying the Kubernetes API for pod status has non-trivial latency (~0.5–1s based on experience with Bee Code Interpreter). Always creating a new Job is simpler and avoids that round-trip entirely.

2. **No inactivity detection.** Detecting that an agent has entered an idle state — and doing so reliably in the presence of background tasks — requires bridging application-level protocol information (e.g., ACP traffic) to the platform layer. Every harness can signal process completion, but "idle" is a much harder predicate. Avoiding it removes a whole class of bookkeeping (tracking idle state, running a reaper job, choosing a timeout value).

3. **No lifecycle race conditions.** A keep-alive container can be simultaneously targeted for wake-up (new message arrives) and teardown (idle timeout fires). When these events overlap, edge cases emerge — e.g., the platform opens a connection to a container that is mid-termination. Single-use Jobs have no such races: a Job is either pending, running, or completed.

Since each Job starts from a clean container image, changes agents make outside the persisted workspace require explicit handling:

**Global tool installs** — Persist `$HOME` on the volume (or at minimum the global install locations: `~/.npm-global`, `~/.local/bin`, mise shims, etc.). This makes `npm install -g`, `uv tool install`, and similar commands survive across turns without a full container rebuild.

**Extra tooling via `mise.toml`** — Agents or users can declare additional tools (specific Node versions, Python versions, CLI utilities) in a `mise.toml` at the workspace root. The mise cache directory is persisted on the volume, so tool resolution is instant on subsequent turns — mise only downloads on first use.

**Init scripts** — Users may need a container preparation step that goes beyond what `mise.toml` covers. This is supported by running an init script at Job startup. There are two categories of init work to consider:

- *Persistable changes* (installing global packages, seeding config in `$HOME`, generating caches) write to the persisted volume. These only need to run once: the script drops a marker file (e.g., `.init-done`) on the volume after first successful execution, and subsequent Jobs skip it entirely. Alternatively, this can be modeled as a mise task with install hooks, which has built-in caching and avoids re-execution automatically.
- *Non-persistable changes* (edits to `/etc/hosts`, `/etc/resolv.conf`, sysctl tunables, installing OS packages outside `$HOME`) write to the container's ephemeral filesystem and are lost when the Job completes. Supporting these in init scripts would mean running the script on every turn, adding its execution time to the critical path of every single interaction.

To avoid per-turn init overhead, we restrict init scripts to persistable changes only. OS-level modifications are disallowed by convention and documented in `AGENTS.md`. This is a real downside of single-use Jobs compared to keep-alive (Alternative 1), where such changes would survive naturally for the lifetime of the container. If a use case genuinely requires system-level configuration, the correct path is a custom container image.

## Alternatives Considered

1. **Keep-alive with idle timeout.** Lower latency for rapid back-and-forth conversations, but introduces all three complexity categories above. Tomas W. proposed hooking into ACP traffic with a ~20-minute timeout; while feasible in the prototype, this still requires bridging protocol-level signals to the platform and handling background tasks correctly. Deferred as a future optimization if latency becomes a measurable problem. Keep-alive would also sidestep the pod-level persistence problem entirely (global installs and `/etc/` edits survive as long as the container lives), but this is not a sufficient reason to accept its complexity.

2. **Configurable per agent.** Most flexible, but adds platform complexity and forces developers to reason about a tradeoff most don't need to make yet. Can be revisited if distinct usage patterns (interactive vs. scheduled) emerge at scale.


## Consequences

- **Startup latency on every turn.** Acceptable for coding agents where task runtime dominates. If short interactive turns become a primary use case, revisit keep-alive (Alternative 1).
- **Simpler lifecycle management.** No health checks, no orphan cleanup, no idle-timeout tuning.
- **Stronger isolation.** Each turn gets a clean process; no leaked state between turns.
- **Container startup optimization matters.** Image size, layer caching, and cold-start performance should be tracked as operational metrics. Init script execution time is part of the critical path on first run.
- **Persisted `$HOME` and mise cache increase volume size.** Global installs and cached tool versions accumulate over time. May need periodic cleanup or size limits.
- **OS-level changes are explicitly unsupported.** This is a deliberate tradeoff documented in `AGENTS.md` to avoid per-turn init script execution. Agents that need system-level customization must use a custom container image. This is a known ergonomic gap compared to keep-alive (Alternative 1).
