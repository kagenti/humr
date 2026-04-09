import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { StatusIndicator } from "../components/StatusIndicator.js";
import { Unplug, RefreshCw } from "lucide-react";
import { authFetch } from "../auth.js";

export function ConnectorsView() {
  const [connections, setConnections] = useState<{ hostname: string; connectedAt: string; expired: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const loaded = useRef(false);
  const showAlert = useStore(s => s.showAlert);
  const showConfirm = useStore(s => s.showConfirm);

  const load = useCallback(async () => {
    // Only show loading spinner on first load — subsequent refreshes are silent
    if (!loaded.current) setLoading(true);
    try {
      const r = await authFetch("/api/mcp/connections");
      const d = await r.json();
      if (Array.isArray(d)) setConnections(d);
      loaded.current = true;
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startOAuth = async () => {
    if (!url.trim()) return;
    setConnecting(true);
    try {
      const res = await authFetch("/api/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mcpServerUrl: url.trim() }) });
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (data.error) { showAlert(data.error, "OAuth Error"); setConnecting(false); return; }
      if (data.authUrl) { sessionStorage.setItem("humr-return-view", "connectors"); window.location.href = data.authUrl; }
    } catch (err) { showAlert(`${err}`, "Connection Failed"); setConnecting(false); }
  };

  const disconnect = async (hostname: string) => {
    if (!await showConfirm(`Disconnect "${hostname}"?`, "Disconnect Server")) return;
    setDisconnecting(hostname);
    try {
      await authFetch(`/api/mcp/connections/${encodeURIComponent(hostname)}`, { method: "DELETE" });
      await load();
    } catch (err) { showAlert(`${err}`, "Disconnect Failed"); }
    setDisconnecting(null);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] font-bold text-text">MCP Connectors</h1>
        <button
          onClick={load}
          className={`ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal ${loading ? "anim-spin" : ""}`}
          style={{ boxShadow: "var(--shadow-brutal-sm)" }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Connected servers */}
      <section className="mb-10">
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">Connected Servers</h2>

        {!loaded.current && loading && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-10 text-center text-[14px] text-text-muted anim-in">
            Loading...
          </div>
        )}

        {loaded.current && connections.length === 0 && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-10 text-center text-[14px] text-text-muted anim-in">
            No connections yet — add one below
          </div>
        )}

        <div className="flex flex-col gap-3">
          {connections.map((c, i) => (
            <div
              key={c.hostname}
              className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] anim-in"
              style={{ boxShadow: "var(--shadow-brutal)", animationDelay: `${i * 50}ms` }}
            >
              <StatusIndicator state={c.expired ? "error" : "ready"} />
              <span className="text-[14px] font-semibold text-text flex-1 truncate">{c.hostname}</span>
              {c.expired ? (
                <span className="text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-danger bg-danger-light text-danger rounded-full px-2.5 py-0.5">Expired</span>
              ) : (
                <span className="text-[12px] text-text-muted">Connected {new Date(c.connectedAt).toLocaleDateString()}</span>
              )}
              {c.expired && (
                <button
                  onClick={() => setUrl(`https://${c.hostname}/mcp`)}
                  className="btn-brutal h-7 rounded-md border-2 border-accent bg-accent-light px-3 text-[11px] font-bold text-accent hover:bg-accent hover:text-white"
                  style={{ boxShadow: "2px 2px 0 var(--color-accent)" }}
                >
                  Reconnect
                </button>
              )}
              <button
                onClick={() => disconnect(c.hostname)}
                disabled={disconnecting === c.hostname}
                className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger disabled:opacity-40"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                title="Disconnect"
              >
                <Unplug size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Connect new */}
      <section className="anim-in" style={{ animationDelay: `${connections.length * 50 + 100}ms` }}>
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
