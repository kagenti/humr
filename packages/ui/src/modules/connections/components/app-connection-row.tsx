import type { AppConnectionView } from "api-server-api";
import { KeyRound } from "lucide-react";

import { AppStatusPill } from "../../../components/app-status-pill.js";

interface Props {
  connection: AppConnectionView;
  animationDelayMs: number;
}

export function AppConnectionRow({ connection, animationDelayMs }: Props) {
  const { label, identity, connectedAt, provider, status } = connection;
  const detail = identity
    ? identity
    : connectedAt
      ? `Connected ${new Date(connectedAt).toLocaleDateString()}`
      : provider;

  return (
    <div
      className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] shadow-brutal anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
        <KeyRound size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-text truncate">{label}</div>
        <div className="text-[12px] font-mono text-text-muted truncate">{detail}</div>
      </div>
      <AppStatusPill status={status} size="md" />
    </div>
  );
}
