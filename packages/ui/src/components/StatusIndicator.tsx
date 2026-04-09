import type { InstanceView } from "../types.js";

export type InstanceState = "running" | "starting" | "hibernated" | "error" | "unknown";

export function instanceState(i: InstanceView): InstanceState {
  if (i.status?.currentState === "error") return "error";
  if (i.desiredState === "hibernated" || i.status?.currentState === "hibernated") return "hibernated";
  if (i.status?.podReady) return "running";
  if (i.status?.currentState === "running") return "starting";
  return "unknown";
}

export const stateLabel: Record<InstanceState, string> = {
  running: "Running",
  starting: "Starting",
  hibernated: "Hibernated",
  error: "Error",
  unknown: "Unknown",
};

export const badgeColors: Record<InstanceState, string> = {
  running: "bg-success-light text-success border-success",
  starting: "bg-warning-light text-warning border-warning",
  hibernated: "bg-bg text-text-muted border-border-light",
  error: "bg-danger-light text-danger border-danger",
  unknown: "bg-bg text-text-muted border-border-light",
};

export const dotColors: Record<InstanceState, string> = {
  running: "bg-success",
  starting: "bg-warning anim-pulse",
  hibernated: "bg-text-muted",
  error: "bg-danger",
  unknown: "bg-text-muted",
};

export function StatusIndicator({ state }: { state: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColors[state as InstanceState] ?? "bg-success"}`} />;
}
