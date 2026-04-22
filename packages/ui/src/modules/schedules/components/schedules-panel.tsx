import { useState } from "react";
import { useStore } from "../../../store.js";
import { Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { useSchedules, useScheduleSessions } from "../api/queries.js";
import {
  useCreateSchedule,
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";

export function SchedulesPanel({ onResumeSession }: { onResumeSession?: (sid: string) => void }) {
  const selectedInstance = useStore(s => s.selectedInstance);
  const showConfirm = useStore(s => s.showConfirm);

  const schedulesQuery = useSchedules(selectedInstance);
  const schedules = schedulesQuery.data ?? [];

  const createSchedule = useCreateSchedule();
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();

  const [show, setShow] = useState(false);
  const [f, setF] = useState({ name: "", cron: "", task: "", sessionMode: "fresh" as "continuous" | "fresh" });
  const [expanded, setExpanded] = useState<string | null>(null);

  const sessionsQuery = useScheduleSessions(expanded);
  const sessionsForExpanded = sessionsQuery.data ?? [];

  const toggleExpanded = (id: string) => {
    setExpanded(prev => prev === id ? null : id);
  };

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
      {schedules.map(s => {
        const isExpanded = expanded === s.id;
        const sessions = isExpanded ? sessionsForExpanded : [];

        return (
          <div key={s.id} className="border-b border-border-light">
            {/* Schedule card header — clickable to expand */}
            <div
              className={`flex flex-col gap-1.5 px-4 py-3 cursor-pointer transition-colors hover:bg-surface-raised ${isExpanded ? "bg-surface-raised" : ""}`}
              onClick={() => toggleExpanded(s.id)}
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown size={12} className="text-text-muted shrink-0" /> : <ChevronRight size={12} className="text-text-muted shrink-0" />}
                <span className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-info-light text-info border-info">cron</span>
                {s.sessionMode === "continuous" && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.03em] border rounded-full px-2 py-0.5 bg-purple-50 text-purple-600 border-purple-300">
                    continuous
                  </span>
                )}
                <span className="text-[13px] font-semibold text-text flex-1 truncate">{s.name}</span>
                <span className="text-[11px] font-mono text-text-muted">{s.cron}</span>
                <button
                  className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 ${s.enabled ? "bg-success-light text-success border-success" : "bg-bg text-text-muted border-border-light"} hover:opacity-80`}
                  onClick={(e) => { e.stopPropagation(); toggleSchedule.mutate({ id: s.id }); }}
                >
                  {s.enabled ? "On" : "Off"}
                </button>
                <button
                  className="text-text-muted hover:text-danger transition-colors"
                  onClick={async (e) => { e.stopPropagation(); if (await showConfirm(`Delete schedule "${s.name}"?`, "Delete Schedule")) deleteSchedule.mutate({ id: s.id }); }}
                >
                  <X size={14} />
                </button>
              </div>
              {s.status && (
                <div className="flex gap-3 text-[11px] text-text-muted pl-5">
                  {s.status.lastRun && <span>last: {new Date(s.status.lastRun).toLocaleString()}</span>}
                  {s.status.nextRun && <span>next: {new Date(s.status.nextRun).toLocaleString()}</span>}
                  {s.status.lastResult && <span className={s.status.lastResult === "success" ? "text-success" : "text-danger"}>{s.status.lastResult}</span>}
                </div>
              )}
            </div>

            {/* Expanded session list */}
            {isExpanded && (
              <div className="border-t border-border-light bg-bg/50">
                {sessions.length === 0 && (
                  <p className="px-4 py-3 text-[11px] text-text-muted pl-9">No sessions yet</p>
                )}
                {sessions.map(session => (
                  <div
                    key={session.sessionId}
                    onClick={() => onResumeSession?.(session.sessionId)}
                    className="flex items-center gap-2 px-4 py-2.5 pl-9 cursor-pointer hover:bg-accent-light transition-colors border-b border-border-light last:border-b-0"
                  >
                    <span className="text-[12px] text-text font-medium truncate flex-1">
                      {session.title || session.sessionId.slice(0, 12)}
                    </span>
                    <span className="text-[10px] text-text-muted shrink-0">
                      created at: {new Date(session.updatedAt ?? session.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
                {s.sessionMode === "continuous" && sessions.length > 0 && (
                  <div className="px-4 py-2 pl-9">
                    <button
                      className="text-[10px] font-bold uppercase tracking-[0.03em] border border-border-light rounded px-1.5 py-0.5 text-text-muted hover:text-danger hover:border-danger transition-colors"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await showConfirm(`Reset session for "${s.name}"? The next tick will start a fresh conversation.`, "Reset Session")) {
                          resetScheduleSession.mutate({ scheduleId: s.id });
                        }
                      }}
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
