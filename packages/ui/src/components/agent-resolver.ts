import type { AgentView, InstanceView, InstanceState } from "../types.js";

export type AgentDisplayState = InstanceState | "restarting" | "no-instance";

export interface AgentDisplay {
  /** The instance to surface for this agent, or null if none exists. */
  instance: InstanceView | null;
  /** Derived state that drives the status pill. */
  state: AgentDisplayState;
  /** Whether the underlying instance is reachable enough to click through. */
  clickable: boolean;
  /** Whether the Restart action is valid in the current state. */
  canRestart: boolean;
}

/**
 * Pure projection: pick which instance to surface for an agent and derive the
 * display-level state. Hides the 1:N agent→instance cardinality from callers.
 * Legacy agents with multiple instances surface the lowest-id instance
 * (deterministic — keeps the UI stable across polls).
 */
export function resolveAgentDisplay(
  agent: AgentView,
  instances: readonly InstanceView[],
  restartingInstanceIds: ReadonlySet<string>,
): AgentDisplay {
  const forAgent = instances
    .filter((i) => i.agentId === agent.id)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const instance = forAgent[0] ?? null;

  if (!instance) {
    return { instance: null, state: "no-instance", clickable: false, canRestart: false };
  }
  const restarting = restartingInstanceIds.has(instance.id);
  const state: AgentDisplayState = restarting ? "restarting" : instance.state;
  const clickable = !restarting && (instance.state === "running" || instance.state === "hibernated");
  const canRestart = !restarting && (instance.state === "running" || instance.state === "error");
  return { instance, state, clickable, canRestart };
}
