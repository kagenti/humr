import { useState, useEffect, useCallback } from "react";
import { StatusIndicator } from "../components/StatusIndicator.js";

export function ConnectorsView() {
  const [connections, setConnections] = useState<{ hostname: string; connectedAt: string; expired: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/mcp/connections").then(r => r.json()).then(d => { if (Array.isArray(d)) setConnections(d); }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const startOAuth = async () => {
    if (!url.trim()) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mcpServerUrl: url.trim() }) });
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (data.error) { alert(`OAuth error: ${data.error}`); setConnecting(false); return; }
      if (data.authUrl) { sessionStorage.setItem("humr-return-view", "connectors"); window.location.href = data.authUrl; }
    } catch (err) { alert(`Failed: ${err}`); setConnecting(false); }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-[24px] font-bold text-text mb-8">MCP Connectors</h1>

      {/* Connected servers */}
      <section className="mb-10">
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">Connected Servers</h2>

        {loading && <p className="text-[13px] text-text-muted py-8">Loading...</p>}

        {!loading && connections.length === 0 && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-10 text-center text-[14px] text-text-muted">
            No connections yet — add one below
          </div>
        )}

        <div className="flex flex-col gap-3">
          {connections.map(c => (
            <div
              key={c.hostname}
              className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#1c1917]"
              style={{ boxShadow: "var(--shadow-brutal)" }}
            >
              <StatusIndicator state={c.expired ? "error" : "ready"} />
              <span className="text-[14px] font-semibold text-text flex-1 truncate">{c.hostname}</span>
              {c.expired ? (
                <>
                  <span className="text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-danger bg-danger-light text-danger rounded-full px-2.5 py-0.5">Expired</span>
                  <button
                    onClick={() => setUrl(`https://${c.hostname}/mcp`)}
                    className="btn-brutal h-7 rounded-md border-2 border-danger bg-danger-light px-3 text-[11px] font-bold text-danger hover:bg-danger hover:text-white"
                    style={{ boxShadow: "2px 2px 0 var(--color-danger)" }}
                  >
                    Reconnect
                  </button>
                </>
              ) : (
                <span className="text-[12px] text-text-muted">Connected {new Date(c.connectedAt).toLocaleDateString()}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Connect new */}
      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">Connect New Server</h2>
        <div className="flex gap-3">
          <input
            className="flex-1 h-10 rounded-lg border-2 border-border-light bg-surface px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && startOAuth()}
            placeholder="https://example.com/mcp"
          />
          <button
            className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            onClick={startOAuth}
            disabled={!url.trim() || connecting}
          >
            {connecting ? "..." : "Connect"}
          </button>
        </div>
      </section>
    </div>
  );
}
