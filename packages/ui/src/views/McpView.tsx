import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { authFetch } from "../auth.js";
import {
  Unplug,
  RefreshCw,
  Globe,
  X,
  Plus,
} from "lucide-react";

interface McpConnection {
  hostname: string;
  connectedAt: string;
  expired: boolean;
}

export function McpView() {
  const showAlert = useStore((s) => s.showAlert);
  const showConfirm = useStore((s) => s.showConfirm);

  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const loaded = useRef(false);

  // MCP form
  const [mcpUrl, setMcpUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      const r = await authFetch("/api/mcp/connections");
      const d = await r.json();
      if (Array.isArray(d)) setConnections(d);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    await loadConnections();
    loaded.current = true;
    setLoading(false);
  }, [loadConnections]);

  useEffect(() => {
    load();
  }, [load]);

  const startMcpOAuth = async () => {
    if (!mcpUrl.trim()) return;
    setConnecting(true);
    try {
      const res = await authFetch("/api/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServerUrl: mcpUrl.trim() }),
      });
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (data.error) {
        showAlert(data.error, "OAuth Error");
        setConnecting(false);
        return;
      }
      if (data.authUrl) {
        sessionStorage.setItem("humr-return-view", "mcp");
        window.location.href = data.authUrl;
      }
    } catch (err) {
      showAlert(`${err}`, "Connection Failed");
      setConnecting(false);
    }
  };

  const disconnectMcp = async (hostname: string) => {
    if (!(await showConfirm(`Disconnect "${hostname}"?`, "Disconnect"))) return;
    setDisconnecting(hostname);
    try {
      await authFetch(`/api/mcp/connections/${encodeURIComponent(hostname)}`, {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      showAlert(`${err}`, "Disconnect Failed");
    }
    setDisconnecting(null);
  };

  const inp =
    "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] font-bold text-text">MCP Servers</h1>
        <button
          onClick={load}
          className="ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal"
          style={{ boxShadow: "var(--shadow-brutal-sm)" }}
        >
          <span className={loading ? "anim-spin" : ""}>
            <RefreshCw size={13} />
          </span>
        </button>
      </div>

      <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">
        Remote MCP server connections via OAuth. Connected servers provide tools that your agents can use.
      </p>

      {/* Connections list */}
      <section className="mb-6">
        {!loaded.current && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
          </div>
        )}

        {loaded.current && connections.length === 0 && !showAdd && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-10 text-center text-[14px] text-text-muted anim-in">
            No MCP servers connected yet
          </div>
        )}

        {loaded.current && connections.length > 0 && (
          <div className="flex flex-col gap-3">
            {connections.map((c, i) => (
              <div
                key={c.hostname}
                className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] anim-in"
                style={{
                  boxShadow: "var(--shadow-brutal)",
                  animationDelay: `${i * 50}ms`,
                }}
              >
                <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
                  <Globe size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-text truncate">
                    {c.hostname}
                  </div>
                  <div className="text-[12px] font-mono text-text-muted truncate">
                    {c.expired
                      ? "Expired"
                      : `Connected ${new Date(c.connectedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <span
                  className={`text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 ${
                    c.expired
                      ? "bg-danger-light text-danger border-danger"
                      : "bg-info-light text-info border-info"
                  }`}
                >
                  {c.expired ? "Expired" : "Connected"}
                </span>
                {c.expired && (
                  <button
                    onClick={() => {
                      setMcpUrl(`https://${c.hostname}/mcp`);
                      setShowAdd(true);
                    }}
                    className="btn-brutal h-7 rounded-md border-2 border-accent bg-accent-light px-3 text-[11px] font-bold text-accent hover:bg-accent hover:text-white"
                    style={{ boxShadow: "2px 2px 0 var(--color-accent)" }}
                  >
                    Reconnect
                  </button>
                )}
                <button
                  onClick={() => disconnectMcp(c.hostname)}
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
        )}
      </section>

      {/* Add MCP Server */}
      <section className="anim-in">
        {!loaded.current ? null : !showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="btn-brutal rounded-xl border-2 border-border bg-surface p-4 text-left flex items-center gap-3 hover:border-accent hover:bg-accent-light transition-colors w-full"
            style={{ boxShadow: "var(--shadow-brutal-sm)" }}
          >
            <div className="w-8 h-8 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
              <Globe size={16} />
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-bold text-text">Connect MCP Server</div>
              <div className="text-[11px] text-text-muted">OAuth to a remote MCP server</div>
            </div>
            <Plus size={14} className="text-text-muted" />
          </button>
        ) : (
          <div
            className="rounded-xl border-2 border-border bg-surface p-6 flex flex-col gap-4 anim-scale-in"
            style={{ boxShadow: "var(--shadow-brutal)" }}
          >
            <div className="flex items-center gap-3">
              <h3 className="text-[14px] font-bold text-text">Connect MCP Server</h3>
              <button
                className="ml-auto text-text-muted hover:text-text"
                onClick={() => setShowAdd(false)}
                title="Cancel"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex gap-3">
              <input
                className={inp}
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startMcpOAuth()}
                placeholder="https://example.com/mcp"
                autoFocus
              />
              <button
                className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40 shrink-0"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={startMcpOAuth}
                disabled={!mcpUrl.trim() || connecting}
              >
                {connecting ? "..." : "Connect"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
