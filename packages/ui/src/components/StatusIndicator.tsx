import type { InstanceView, InstanceState } from "../types.js";

export type { InstanceState };

export function instanceState(i: InstanceView): InstanceState {
  return i.state;
}

export const stateLabel: Record<InstanceState, string> = {
  idle: "Idle",
  starting: "Starting",
  running: "Running",
  error: "Error",
};

export const badgeColors: Record<InstanceState, string> = {
  idle: "bg-success-light text-success border-success",
  starting: "bg-warning-light text-warning border-warning",
  running: "bg-success-light text-success border-success",
  error: "bg-danger-light text-danger border-danger",
};

export const dotColors: Record<InstanceState, string> = {
  idle: "bg-success",
  starting: "bg-warning anim-pulse",
  running: "bg-success",
  error: "bg-danger",
};

export function StatusIndicator({ state }: { state: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColors[state as InstanceState] ?? "bg-success"}`} />;
}
