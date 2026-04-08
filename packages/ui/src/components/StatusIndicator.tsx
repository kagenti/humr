const colors: Record<string, string> = {
  ready: "bg-success",
  running: "bg-warning",
  hibernated: "bg-text-muted",
  error: "bg-danger",
};

export function StatusIndicator({ state }: { state: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${colors[state] ?? "bg-text-muted"}`} />;
}
