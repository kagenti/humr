import { useState } from "react";
import { useStore } from "../../../store.js";
import { Plus } from "lucide-react";
import { useSchedules, useScheduleSessions } from "../api/queries.js";
import { ScheduleCard } from "./schedule-card.js";
import { CreateScheduleForm } from "../forms/create-schedule-form.js";

export function SchedulesPanel({ onResumeSession }: { onResumeSession?: (sid: string) => void }) {
  const selectedInstance = useStore(s => s.selectedInstance);

  const schedulesQuery = useSchedules(selectedInstance);
  const schedules = schedulesQuery.data ?? [];

  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sessionsQuery = useScheduleSessions(expanded);
  const sessionsForExpanded = sessionsQuery.data ?? [];

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2.5 shrink-0">
        <button
          className="w-full h-7 rounded-md border border-border-light text-[11px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center justify-center gap-1 transition-colors"
          onClick={() => setShow(true)}
        >
          <Plus size={12} /> Add Schedule
        </button>
      </div>

      {show && selectedInstance && (
        <CreateScheduleForm
          instanceId={selectedInstance}
          onCancel={() => setShow(false)}
          onCreated={() => setShow(false)}
        />
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
