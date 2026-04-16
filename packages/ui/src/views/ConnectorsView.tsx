import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { getAuthConfig } from "../auth.js";
import type { AnthropicAuthMode } from "../types.js";
import {
  Unplug,
  RefreshCw,
  KeyRound,
  Plus,
  Sparkles,
  Globe,
  Lock,
  ExternalLink,
  X,
} from "lucide-react";
import { authFetch } from "../auth.js";

interface McpConnection {
  hostname: string;
  connectedAt: string;
  expired: boolean;
}

type AddMode = null | "mcp" | "secret" | "app";

export function ConnectorsView() {
  const secrets = useStore((s) => s.secrets);
  const fetchSecrets = useStore((s) => s.fetchSecrets);
  const createSecret = useStore((s) => s.createSecret);
  const deleteSecret = useStore((s) => s.deleteSecret);
  const showAlert = useStore((s) => s.showAlert);
  const showConfirm = useStore((s) => s.showConfirm);

  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const loaded = useRef(false);

  // MCP form
  const [mcpUrl, setMcpUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Generic-secret form
  const [secretForm, setSecretForm] = useState({
    name: "",
    value: "",
    hostPattern: "",
  });
  const [savingSecret, setSavingSecret] = useState(false);

  // Anthropic form
  const [anthropicKey, setAnthropicKey] = useState("");
  const [savingAnthropic, setSavingAnthropic] = useState(false);

  const onecliUrl = getAuthConfig()?.onecliUrl;

  const loadConnections = useCallback(async () => {
    try {
      const r = await authFetch("/api/mcp/connections");
      const d = await r.json();
      if (Array.isArray(d)) setConnections(d);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    await Promise.all([loadConnections(), fetchSecrets()]);
    loaded.current = true;
    setLoading(false);
  }, [loadConnections, fetchSecrets]);

  useEffect(() => {
    load();
  }, [load]);

  // Derived data
  const anthropic = secrets.find((s) => s.type === "anthropic");
  const genericConnectors = secrets.filter(
    (s) => s.type !== "anthropic" && !s.name.startsWith("__humr_mcp:"),
  );

  // --- Actions ---

  const saveAnthropic = async () => {
    if (!anthropicKey.trim()) return;
    setSavingAnthropic(true);
    try {
      await createSecret({
        type: "anthropic",
        name: "Anthropic API Key",
        value: anthropicKey.trim(),
      });
      setAnthropicKey("");
    } finally {
      setSavingAnthropic(false);
    }
  };

  const removeAnthropic = async () => {
    if (!anthropic) return;
    if (!(await showConfirm("Remove Anthropic API key?", "Remove Key"))) return;
    await deleteSecret(anthropic.id);
  };

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
        sessionStorage.setItem("humr-return-view", "connectors");
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

  const saveSecret = async () => {
    if (
      !secretForm.name.trim() ||
      !secretForm.value.trim() ||
      !secretForm.hostPattern.trim()
    )
      return;
    setSavingSecret(true);
    try {
      await createSecret({
        type: "generic",
        name: secretForm.name.trim(),
        value: secretForm.value.trim(),
        hostPattern: secretForm.hostPattern.trim(),
      });
      setSecretForm({ name: "", value: "", hostPattern: "" });
      setAddMode(null);
    } finally {
      setSavingSecret(false);
    }
  };

  const deleteGeneric = async (id: string, name: string) => {
    if (!(await showConfirm(`Delete "${name}"?`, "Delete Connector"))) return;
    await deleteSecret(id);
  };

  const hasConnectors = connections.length > 0 || genericConnectors.length > 0;

  const inp =
    "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] font-bold text-text">Connectors</h1>
        <button
          onClick={load}
          className={`ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal`}
          style={{ boxShadow: "var(--shadow-brutal-sm)" }}
        >
          <span className={loading ? "anim-spin" : ""}>
            <RefreshCw size={13} />
          </span>
        </button>
      </div>

      {/* Anthropic — featured top section */}
      <section className="mb-10">
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">
          Anthropic Credentials
        </h2>
        {!loaded.current ? (
          <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 h-[72px] anim-pulse" />
        ) : anthropic ? (
          <div
            className="flex items-center gap-4 rounded-xl border-2 border-accent bg-accent-light px-5 py-4 anim-in"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
          >
            <div className="w-10 h-10 shrink-0 rounded-lg bg-accent flex items-center justify-center text-white">
              <Sparkles size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[14px] font-semibold text-text truncate">
                  {anthropic.name}
                </span>
                <AuthModeBadge mode={anthropic.authMode} />
              </div>
              <div className="text-[12px] text-text-muted">
                Connected · used by Claude models
              </div>
            </div>
            <button
              onClick={removeAnthropic}
              className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger"
              style={{ boxShadow: "var(--shadow-brutal-sm)" }}
              title="Remove"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div
            className="rounded-xl border-2 border-warning bg-warning-light p-5 anim-in flex flex-col gap-3"
            style={{ boxShadow: "var(--shadow-brutal)" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-warning flex items-center justify-center text-white">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-text">
                  Not configured
                </div>
                <div className="text-[12px] text-text-muted">
                  Required for Claude models. Paste an API key (
                  <span className="font-mono">sk-ant-api…</span>) or an OAuth
                  token (<span className="font-mono">sk-ant-oat…</span>) — the
                  type is detected automatically.
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <input
                className={inp}
                type="password"
                placeholder="sk-ant-api… or sk-ant-oat…"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveAnthropic()}
              />
              <button
                className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40 shrink-0"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={saveAnthropic}
                disabled={!anthropicKey.trim() || savingAnthropic}
              >
                {savingAnthropic ? "..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Unified connectors list */}
      <section className="mb-6">
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">
          Connectors
        </h2>

        {!loaded.current && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
          </div>
        )}

        {loaded.current && !hasConnectors && addMode === null && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-10 text-center text-[14px] text-text-muted anim-in">
            No connectors yet — add one below
          </div>
        )}

        {loaded.current && (
          <div className="flex flex-col gap-3">
            {connections.map((c, i) => (
              <ConnectorRow
                key={`mcp:${c.hostname}`}
                index={i}
                iconType="mcp"
                name={c.hostname}
                subtitle={
                  c.expired
                    ? "Expired"
                    : `Connected ${new Date(c.connectedAt).toLocaleDateString()}`
                }
                badge={
                  c.expired
                    ? { label: "Expired", tone: "danger" }
                    : { label: "MCP", tone: "info" }
                }
                reconnect={
                  c.expired
                    ? () => {
                        setMcpUrl(`https://${c.hostname}/mcp`);
                        setAddMode("mcp");
                      }
                    : undefined
                }
                onDelete={() => disconnectMcp(c.hostname)}
                deleting={disconnecting === c.hostname}
              />
            ))}
            {genericConnectors.map((s, i) => (
              <ConnectorRow
                key={`secret:${s.id}`}
                index={connections.length + i}
                iconType="secret"
                name={s.name}
                subtitle={s.hostPattern}
                badge={{ label: "Secret", tone: "muted" }}
                onDelete={() => deleteGeneric(s.id, s.name)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Add connector — type picker */}
      <section className="anim-in">
        {!loaded.current ? null : addMode === null ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
              Add Connector
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <AddTypeCard
                icon={<Globe size={18} />}
                title="MCP Server"
                description="OAuth to an MCP server"
                onClick={() => setAddMode("mcp")}
              />
              <AddTypeCard
                icon={<Lock size={18} />}
                title="Secret"
                description="Token for a custom host"
                onClick={() => setAddMode("secret")}
              />
              <AddTypeCard
                icon={<KeyRound size={18} />}
                title="Preconfigured App"
                description="GitHub, Google, etc."
                onClick={() => setAddMode("app")}
              />
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl border-2 border-border bg-surface p-6 flex flex-col gap-4 anim-scale-in"
            style={{ boxShadow: "var(--shadow-brutal)" }}
          >
            <div className="flex items-center gap-3">
              <h3 className="text-[14px] font-bold text-text">
                {addMode === "mcp" && "Connect MCP Server"}
                {addMode === "secret" && "Add Secret"}
                {addMode === "app" && "Preconfigured App"}
              </h3>
              <button
                className="ml-auto text-text-muted hover:text-text"
                onClick={() => setAddMode(null)}
                title="Cancel"
              >
                <X size={16} />
              </button>
            </div>

            {addMode === "mcp" && (
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
            )}

            {addMode === "secret" && (
              <div className="flex flex-col gap-5">
                <p className="text-[13px] text-text-secondary leading-relaxed">
                  Injects a bearer token into outgoing HTTP requests whose host
                  matches the pattern below. Use this for custom APIs — for
                  common providers (GitHub, Google, Resend…) pick
                  <strong> Preconfigured App</strong> instead.
                </p>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                    Name
                  </label>
                  <input
                    className={inp}
                    placeholder="e.g. Linear Token"
                    value={secretForm.name}
                    onChange={(e) =>
                      setSecretForm((p) => ({ ...p, name: e.target.value }))
                    }
                    autoFocus
                  />
                  <p className="text-[11px] text-text-muted">
                    A label so you can identify this connector later.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                    Token
                  </label>
                  <input
                    className={inp}
                    type="password"
                    placeholder="The secret value to inject"
                    value={secretForm.value}
                    onChange={(e) =>
                      setSecretForm((p) => ({ ...p, value: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-text-muted">
                    Injected as{" "}
                    <span className="font-mono">
                      Authorization: Bearer &lt;value&gt;
                    </span>
                    . Stored encrypted in OneCLI — the agent never sees the raw
                    value.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                    Host Pattern
                  </label>
                  <input
                    className={`${inp} font-mono`}
                    placeholder="e.g. api.linear.app"
                    value={secretForm.hostPattern}
                    onChange={(e) =>
                      setSecretForm((p) => ({
                        ...p,
                        hostPattern: e.target.value,
                      }))
                    }
                  />
                  <p className="text-[11px] text-text-muted">
                    Hostname the token applies to. Requests to other hosts are
                    untouched. Supports wildcards (e.g.{" "}
                    <span className="font-mono">*.example.com</span>).
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40"
                    style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                    onClick={saveSecret}
                    disabled={
                      savingSecret ||
                      !secretForm.name.trim() ||
                      !secretForm.value.trim() ||
                      !secretForm.hostPattern.trim()
                    }
                  >
                    {savingSecret ? "..." : "Add Secret"}
                  </button>
                </div>
              </div>
            )}

            {addMode === "app" && (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] text-text-secondary">
                  Preconfigured apps (GitHub, Google, Slack…) are set up in the
                  OneCLI dashboard. Once connected there, the resulting secret
                  will appear in this list automatically.
                </p>
                {onecliUrl ? (
                  <a
                    href={`${onecliUrl}/connections`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white inline-flex items-center justify-center gap-2 self-start"
                    style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                  >
                    Open OneCLI Dashboard <ExternalLink size={13} />
                  </a>
                ) : (
                  <p className="text-[12px] text-text-muted">
                    OneCLI dashboard URL not configured.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

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

function AddTypeCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="btn-brutal rounded-xl border-2 border-border bg-surface p-4 text-left flex flex-col gap-2 hover:border-accent hover:bg-accent-light transition-colors"
      style={{ boxShadow: "var(--shadow-brutal-sm)" }}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
          {icon}
        </div>
        <Plus size={14} className="text-text-muted ml-auto" />
      </div>
      <div>
        <div className="text-[13px] font-bold text-text">{title}</div>
        <div className="text-[11px] text-text-muted">{description}</div>
      </div>
    </button>
  );
}

function ConnectorRow({
  index,
  iconType,
  name,
  subtitle,
  badge,
  reconnect,
  onDelete,
  deleting,
}: {
  index: number;
  iconType: "mcp" | "secret";
  name: string;
  subtitle: string;
  badge: { label: string; tone: "info" | "muted" | "danger" };
  reconnect?: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  const toneClass = {
    info: "bg-info-light text-info border-info",
    muted: "bg-surface-raised text-text-muted border-border-light",
    danger: "bg-danger-light text-danger border-danger",
  }[badge.tone];

  return (
    <div
      className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] anim-in"
      style={{
        boxShadow: "var(--shadow-brutal)",
        animationDelay: `${index * 50}ms`,
      }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
        {iconType === "mcp" ? <Globe size={16} /> : <Lock size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-text truncate">
          {name}
        </div>
        <div className="text-[12px] font-mono text-text-muted truncate">
          {subtitle}
        </div>
      </div>
      <span
        className={`text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 ${toneClass}`}
      >
        {badge.label}
      </span>
      {reconnect && (
        <button
          onClick={reconnect}
          className="btn-brutal h-7 rounded-md border-2 border-accent bg-accent-light px-3 text-[11px] font-bold text-accent hover:bg-accent hover:text-white"
          style={{ boxShadow: "2px 2px 0 var(--color-accent)" }}
        >
          Reconnect
        </button>
      )}
      <button
        onClick={onDelete}
        disabled={deleting}
        className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger disabled:opacity-40"
        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
        title="Remove"
      >
        {iconType === "mcp" ? <Unplug size={13} /> : <X size={13} />}
      </button>
    </div>
  );
}
