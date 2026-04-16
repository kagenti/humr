import type { AnthropicAuthMode } from "../types.js";

export function AuthModeBadge({ mode }: { mode?: AnthropicAuthMode }) {
  if (!mode) return null;
  const label = mode === "oauth" ? "OAuth Token" : "API Key";
  const tone =
    mode === "oauth"
      ? "bg-info-light text-info border-info"
      : "bg-warning-light text-warning border-warning";
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 shrink-0 ${tone}`}
      title={
        mode === "oauth"
          ? "Stored as sk-ant-oat… — injected as Authorization: Bearer header"
          : "Stored as sk-ant-api… — injected as x-api-key header"
      }
    >
      {label}
    </span>
  );
}
