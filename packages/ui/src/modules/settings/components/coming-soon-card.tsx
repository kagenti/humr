import { Sparkles } from "lucide-react";

export function ComingSoonCard({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 opacity-60 shadow-brutal-sm">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-muted">
          <Sparkles size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[14px] font-semibold text-text">{name}</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 border-border-light bg-surface-raised text-text-muted rounded-full px-2 py-0.5">
              Coming Soon
            </span>
          </div>
          <div className="text-[12px] text-text-muted">{description}</div>
        </div>
      </div>
    </div>
  );
}
