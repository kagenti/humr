import { useStore } from "../store.js";
import { RefreshCw } from "lucide-react";

export function SessionsSidebar({ onResumeSession, onRefresh }: { onResumeSession: (sid: string) => void; onRefresh: () => void }) {
  const sessions = useStore(s => s.sessions);
  const sessionId = useStore(s => s.sessionId);
  const loading = useStore(s => s.loading.sessions);

  return (
    <>
      <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0 relative">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">Sessions</span>
        <button
          className={`h-6 w-6 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent transition-colors ${loading ? "anim-spin" : ""}`}
          onClick={onRefresh}
        >
          <RefreshCw size={11} />
        </button>
        {loading && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent/20 overflow-hidden"><div className="h-full w-1/3 bg-accent rounded-full anim-slide" /></div>}
      </div>
      <div className="flex-1 overflow-y-auto">
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
    </>
  );
}
