import { useState } from "react";
import { useStore } from "../../../store.js";
import { Plus } from "lucide-react";
import { useSchedules, useScheduleSessions } from "../api/queries.js";
import { useCreateSchedule } from "../api/mutations.js";
import { ScheduleCard } from "./schedule-card.js";

export function SchedulesPanel({ onResumeSession }: { onResumeSession?: (sid: string) => void }) {
  const selectedInstance = useStore(s => s.selectedInstance);

  const schedulesQuery = useSchedules(selectedInstance);
  const schedules = schedulesQuery.data ?? [];

  const createSchedule = useCreateSchedule();

  const [show, setShow] = useState(false);
  const [f, setF] = useState({ name: "", cron: "", task: "", sessionMode: "fresh" as "continuous" | "fresh" });
  const [expanded, setExpanded] = useState<string | null>(null);

  const sessionsQuery = useScheduleSessions(expanded);
  const sessionsForExpanded = sessionsQuery.data ?? [];

  const create = () => {
    if (!selectedInstance) return;
    createSchedule.mutate(
      {
        name: f.name,
        instanceId: selectedInstance,
        cron: f.cron,
        task: f.task,
        sessionMode: f.sessionMode === "fresh" ? undefined : f.sessionMode,
      },
      { onSuccess: () => setShow(false) },
    );
  };

  const inp = "w-full h-8 rounded-md border-2 border-border-light bg-surface px-3 text-[12px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2.5 shrink-0">
        <button
          className="w-full h-7 rounded-md border border-border-light text-[11px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center justify-center gap-1 transition-colors"
          onClick={() => { setF({ name: "", cron: "", task: "", sessionMode: "fresh" }); setShow(true); }}
        >
          <Plus size={12} /> Add Schedule
        </button>
      </div>

      {show && (
        <div className="flex flex-col gap-3 border-b border-border-light p-4 anim-in">
          <input className={inp} placeholder="Name" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} />
          <input className={`${inp} font-mono`} placeholder="Cron expression" value={f.cron} onChange={e => setF(p => ({ ...p, cron: e.target.value }))} />
          <textarea className="w-full rounded-md border-2 border-border-light bg-surface px-3 py-2 text-[12px] text-text outline-none transition-all focus:border-accent resize-y min-h-[50px]" placeholder="Task prompt" value={f.task} onChange={e => setF(p => ({ ...p, task: e.target.value }))} rows={2} />
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-text-secondary">Session:</span>
            {(["fresh", "continuous"] as const).map(m => (
              <button
                key={m}
                className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 capitalize ${f.sessionMode === m ? "bg-accent text-white border-accent-hover" : "bg-surface text-text-muted border-border-light"}`}
                onClick={() => setF(p => ({ ...p, sessionMode: m }))}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button className="h-7 rounded-md border-2 border-border-light px-3 text-[11px] font-semibold text-text-muted hover:text-text transition-colors" onClick={() => setShow(false)}>Cancel</button>
            <button
              className="btn-brutal h-7 rounded-md border-2 border-accent-hover bg-accent px-3.5 text-[11px] font-bold text-white disabled:opacity-40"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
              disabled={createSchedule.isPending || !f.name.trim()}
              onClick={create}
            >
              {createSchedule.isPending ? "..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {schedules.length === 0 && !show && <p className="px-4 py-5 text-[12px] text-text-muted">No schedules</p>}
      {schedules.map(s => (
        <ScheduleCard
          key={s.id}
          schedule={s}
          isExpanded={expanded === s.id}
          sessions={expanded === s.id ? sessionsForExpanded : []}
          onToggleExpanded={() => setExpanded(prev => prev === s.id ? null : s.id)}
          onResumeSession={onResumeSession}
        />
      ))}
    </div>
  );
}
