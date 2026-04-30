import { KeyRound, Plug, Unplug } from "lucide-react";

import { useStore } from "../../../store.js";
import type { OAuthAppConnection, OAuthAppDescriptor } from "../api/fetchers.js";
import { useDisconnectApp } from "../api/mutations.js";

interface Props {
  app: OAuthAppDescriptor;
  connection: OAuthAppConnection | null;
  animationDelayMs: number;
  onConnect: (app: OAuthAppDescriptor) => void;
}

export function OAuthAppRow({ app, connection, animationDelayMs, onConnect }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const disconnectApp = useDisconnectApp();

  const isDisconnecting = disconnectApp.isPending && disconnectApp.variables === app.id;
  const expired = connection?.expired ?? false;
  const connected = connection != null;

  const handleDisconnect = async () => {
    if (!(await showConfirm(`Disconnect ${app.displayName}?`, "Disconnect"))) return;
    disconnectApp.mutate(app.id);
  };

  // Generic key icon — matches AppConnectionRow for visual consistency
  // until we have provider-specific brand assets.
  const Icon = KeyRound;

  const detail = connected
    ? expired
      ? "Expired — reconnect to refresh access"
      : `Connected ${new Date(connection.connectedAt).toLocaleDateString()} · ${connection.hostPattern}`
    : app.description;

  const headline = connection?.displayName ?? app.displayName;

  return (
    <div
      className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] shadow-brutal anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-text truncate">{headline}</div>
        <div className="text-[12px] font-mono text-text-muted truncate">{detail}</div>
      </div>
      {connected && (
        <span
          className={`text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 ${
            expired
              ? "bg-danger-light text-danger border-danger"
              : "bg-info-light text-info border-info"
          }`}
        >
          {expired ? "Expired" : "Connected"}
        </span>
      )}
      {!connected || expired ? (
        <button
          onClick={() => onConnect(app)}
          className="btn-brutal h-7 rounded-md border-2 border-accent bg-accent-light px-3 text-[11px] font-bold text-accent hover:bg-accent hover:text-white shadow-[2px_2px_0_var(--color-accent)] flex items-center gap-1"
        >
          <Plug size={11} />
          {expired ? "Reconnect" : "Connect"}
        </button>
      ) : null}
      {connected && (
        <button
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger disabled:opacity-40 shadow-brutal-sm"
          title="Disconnect"
        >
          <Unplug size={13} />
        </button>
      )}
    </div>
  );
}
