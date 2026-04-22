import { ChevronDown, ChevronRight, X } from "lucide-react";

import { useStore } from "../../../store.js";
import type { Schedule, SessionView } from "../../../types.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";

interface Props {
  schedule: Schedule;
  isExpanded: boolean;
  sessions: SessionView[];
  onToggleExpanded: () => void;
  onResumeSession?: (sessionId: string) => void;
}

export function ScheduleCard({
  schedule,
  isExpanded,
  sessions,
  onToggleExpanded,
  onResumeSession,
}: Props) {
  const { id, name, cron, enabled, sessionMode, status } = schedule;
  const showConfirm = useStore(s => s.showConfirm);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();

  const handleToggleEnabled = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSchedule.mutate({ id });
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await showConfirm(`Delete schedule "${name}"?`, "Delete Schedule")) {
      deleteSchedule.mutate({ id });
    }
  };

  const handleResetSession = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await showConfirm(
      `Reset session for "${name}"? The next tick will start a fresh conversation.`,
      "Reset Session",
    )) {
      resetScheduleSession.mutate({ scheduleId: id });
    }
  };

  return (
    <div className="border-b border-border-light">
      <div
        className={`flex flex-col gap-1.5 px-4 py-3 cursor-pointer transition-colors hover:bg-surface-raised ${isExpanded ? "bg-surface-raised" : ""}`}
        onClick={onToggleExpanded}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown size={12} className="text-text-muted shrink-0" /> : <ChevronRight size={12} className="text-text-muted shrink-0" />}
          <span className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 bg-info-light text-info border-info">cron</span>
          {sessionMode === "continuous" && (
            <span className="text-[10px] font-bold uppercase tracking-[0.03em] border rounded-full px-2 py-0.5 bg-purple-50 text-purple-600 border-purple-300">
              continuous
            </span>
          )}
          <span className="text-[13px] font-semibold text-text flex-1 truncate">{name}</span>
          <span className="text-[11px] font-mono text-text-muted">{cron}</span>
          <button
            className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 ${enabled ? "bg-success-light text-success border-success" : "bg-bg text-text-muted border-border-light"} hover:opacity-80`}
            onClick={handleToggleEnabled}
          >
            {enabled ? "On" : "Off"}
          </button>
          <button
            className="text-text-muted hover:text-danger transition-colors"
            onClick={handleDelete}
          >
            <X size={14} />
          </button>
        </div>
        {status && (
          <div className="flex gap-3 text-[11px] text-text-muted pl-5">
            {status.lastRun && <span>last: {new Date(status.lastRun).toLocaleString()}</span>}
            {status.nextRun && <span>next: {new Date(status.nextRun).toLocaleString()}</span>}
            {status.lastResult && <span className={status.lastResult === "success" ? "text-success" : "text-danger"}>{status.lastResult}</span>}
          </div>
        )}
      </div>

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
          {sessionMode === "continuous" && sessions.length > 0 && (
            <div className="px-4 py-2 pl-9">
              <button
                className="text-[10px] font-bold uppercase tracking-[0.03em] border border-border-light rounded px-1.5 py-0.5 text-text-muted hover:text-danger hover:border-danger transition-colors"
                onClick={handleResetSession}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
