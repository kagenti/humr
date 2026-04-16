import type { InstanceView, InstanceState } from "../types.js";

export type { InstanceState };

export function instanceState(i: InstanceView): InstanceState {
  return i.state;
}

export const stateLabel: Record<InstanceState, string> = {
  idle: "Idle",
  running: "Running",
  starting: "Starting",
  hibernating: "Hibernating",
  hibernated: "Hibernated",
  error: "Error",
};

export const badgeColors: Record<InstanceState, string> = {
  idle: "bg-bg text-text-muted border-border-light",
  running: "bg-success-light text-success border-success",
  starting: "bg-warning-light text-warning border-warning",
  hibernating: "bg-warning-light text-warning border-warning",
  hibernated: "bg-bg text-text-muted border-border-light",
  error: "bg-danger-light text-danger border-danger",
};

export const dotColors: Record<InstanceState, string> = {
  idle: "bg-text-muted",
  running: "bg-success",
  starting: "bg-warning anim-pulse",
  hibernating: "bg-warning anim-pulse",
  hibernated: "bg-text-muted",
  error: "bg-danger",
};

export function StatusIndicator({ state }: { state: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColors[state as InstanceState] ?? "bg-success"}`} />;
}
