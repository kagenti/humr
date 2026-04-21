import type { InstanceView, InstanceState } from "../types.js";
import type { AgentDisplayState } from "./agent-resolver.js";

export type { InstanceState };

export function instanceState(i: InstanceView): InstanceState {
  return i.state;
}

export const stateLabel: Record<AgentDisplayState, string> = {
  running: "Running",
  starting: "Starting",
  hibernating: "Hibernating",
  hibernated: "Hibernated",
  error: "Error",
  restarting: "Restarting",
  "no-instance": "No instance",
};

export const badgeColors: Record<AgentDisplayState, string> = {
  running: "bg-success-light text-success border-success",
  starting: "bg-warning-light text-warning border-warning",
  hibernating: "bg-warning-light text-warning border-warning",
  hibernated: "bg-warning-light text-text-muted border-border-light",
  error: "bg-danger-light text-danger border-danger",
  restarting: "bg-warning-light text-warning border-warning",
  "no-instance": "bg-surface text-text-muted border-border-light",
};

export const dotColors: Record<AgentDisplayState, string> = {
  running: "bg-success",
  starting: "bg-warning anim-pulse",
  hibernating: "bg-warning anim-pulse",
  hibernated: "bg-text-muted",
  error: "bg-danger",
  restarting: "bg-warning anim-pulse",
  "no-instance": "bg-text-muted",
};

export function StatusIndicator({ state }: { state: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColors[state as AgentDisplayState] ?? "bg-success"}`} />;
}
