import { useStore } from "../store.js";
import { RefreshCw } from "lucide-react";

export function SessionsSidebar({ onResumeSession, onRefresh }: { onResumeSession: (sid: string) => void; onRefresh: () => void }) {
  const sessions = useStore(s => s.sessions);
  const sessionId = useStore(s => s.sessionId);
  const loading = useStore(s => s.loading.sessions);

  return (
    <aside className="w-[220px] shrink-0 flex flex-col border-r-[3px] border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 h-12 border-b-2 border-border-light shrink-0">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">Sessions</span>
        <button className="btn-brutal h-6 w-6 rounded-md border-2 border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent" onClick={onRefresh}>
          <RefreshCw size={11} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-4 py-5 text-[12px] text-text-muted">Loading...</p>}
        {!loading && sessions.length === 0 && <p className="px-4 py-5 text-[12px] text-text-muted">No sessions yet</p>}
        {sessions.map(s => (
          <div
            key={s.sessionId}
            onClick={() => onResumeSession(s.sessionId)}
            className={`flex flex-col gap-0.5 px-4 py-3 cursor-pointer border-b border-border-light transition-colors hover:bg-accent-light ${s.sessionId === sessionId ? "bg-accent-light border-l-[3px] border-l-accent" : ""}`}
          >
            <span className={`text-[13px] truncate ${s.sessionId === sessionId ? "text-accent font-bold" : "text-text font-medium"}`}>
              {s.title || s.sessionId.slice(0, 12)}
            </span>
            {s.updatedAt && <span className="text-[11px] text-text-muted">{new Date(s.updatedAt).toLocaleString()}</span>}
          </div>
        ))}
      </div>
    </aside>
  );
}
