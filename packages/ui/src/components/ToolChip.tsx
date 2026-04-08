import { useState } from "react";
import type { ToolChip as T } from "../types.js";
import { ChevronRight, ChevronDown, Settings, Check, X, Loader } from "lucide-react";

const statusColor: Record<string, string> = {
  pending: "text-text-muted",
  in_progress: "text-warning",
  running: "text-warning",
  completed: "text-success",
  failed: "text-danger",
};

export function ToolChip({ chip }: { chip: T }) {
  const [open, setOpen] = useState(false);
  const hasContent = chip.content && chip.content.length > 0;
  const color = statusColor[chip.status] ?? statusColor.pending;

  return (
    <div className="text-[12px]">
      <button
        className={`inline-flex items-center gap-1 py-0.5 font-medium ${color} ${hasContent ? "cursor-pointer hover:opacity-80" : ""}`}
        onClick={hasContent ? () => setOpen(o => !o) : undefined}
      >
        {hasContent ? (
          open ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <Settings size={11} />
        )}
        <span className="font-semibold">{chip.title}</span>
        {chip.status === "completed" ? <Check size={12} /> :
         chip.status === "failed" ? <X size={12} /> :
         (chip.status === "in_progress" || chip.status === "running") ? <Loader size={11} className="anim-spin" /> :
         <span className="text-[10px] opacity-60">{chip.status}</span>}
      </button>
      {open && chip.content && (
        <pre className="mt-1 ml-4 px-3 py-2 rounded-lg bg-surface-raised border border-border-light text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-[1.5]">
          {chip.content.map(c => c.text).join("\n")}
        </pre>
      )}
    </div>
  );
}
