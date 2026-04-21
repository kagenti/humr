import { useStore } from "../store.js";
import { AlertTriangle, AlertCircle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import type { Toast, ToastKind } from "../store/toast.js";

const ICON: Record<ToastKind, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

const COLOR: Record<ToastKind, { border: string; bg: string; icon: string }> = {
  error:   { border: "border-danger",  bg: "bg-danger-light",  icon: "text-danger" },
  warning: { border: "border-warning", bg: "bg-warning-light", icon: "text-warning" },
  success: { border: "border-success", bg: "bg-success-light", icon: "text-success" },
  info:    { border: "border-info",    bg: "bg-info-light",    icon: "text-info" },
};

export function ToastOverlay() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-[360px] pointer-events-none">
      {toasts.map((t) => <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICON[toast.kind];
  const c = COLOR[toast.kind];
  const isError = toast.kind === "error";
  return (
    <div
      className={`pointer-events-auto rounded-lg border-2 ${c.border} ${c.bg} bg-surface p-3 flex items-start gap-2.5 anim-scale-in`}
      style={{ boxShadow: "var(--shadow-brutal-sm)" }}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <Icon size={16} className={`${c.icon} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0 text-[13px] text-text leading-snug break-words">{toast.message}</div>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onDismiss(); }}
          className="shrink-0 text-[12px] font-bold text-accent hover:underline"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        className="shrink-0 h-5 w-5 rounded-md flex items-center justify-center text-text-muted hover:text-text transition-colors"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}
