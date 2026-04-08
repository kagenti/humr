import type { ToolChip as T } from "../types.js";
import { Settings } from "lucide-react";

const styles: Record<string, string> = {
  pending: "bg-bg text-text-muted border-border-light",
  in_progress: "bg-warning-light text-warning border-warning",
  running: "bg-warning-light text-warning border-warning",
  completed: "bg-success-light text-success border-success",
  failed: "bg-danger-light text-danger border-danger",
};

export function ToolChip({ chip }: { chip: T }) {
  return (
    <span className={`inline-flex items-center gap-1.5 border-2 rounded-full px-3 py-1 text-[12px] font-bold ${styles[chip.status] ?? styles.pending}`}>
      <Settings size={12} />
      {chip.title}
      <span className="text-[10px] opacity-70">{chip.status}</span>
    </span>
  );
}
