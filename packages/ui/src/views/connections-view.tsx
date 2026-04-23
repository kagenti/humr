import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { getAuthConfig, authFetch } from "../auth.js";
import { platform } from "../platform.js";
import {
  DEFAULT_INJECTION_CONFIG,
  type EnvMapping,
  type McpConnection,
  type SecretView,
  isCustomSecret,
} from "../types.js";
import type { AppConnectionView } from "api-server-api";
import {
  EnvMappingsEditor,
  allEnvMappingsValid,
  sanitizeEnvMappings,
} from "../components/env-mappings-editor.js";
import { EditSecretDialog } from "../modules/secrets/components/edit-secret-dialog.js";
import { useSecrets } from "../modules/secrets/api/queries.js";
import { useCreateSecret, useDeleteSecret } from "../modules/secrets/api/mutations.js";
import { AppStatusPill } from "../components/app-status-pill.js";
import {
  RefreshCw,
  Lock,
  KeyRound,
  Globe,
  Unplug,
  Plus,
  Pencil,
  ExternalLink,
  X,
} from "lucide-react";

const emptySecretForm = {
  name: "",
  value: "",
  hostPattern: "",
  pathPattern: "",
  headerName: "",
  valueFormat: "",
};

export function ConnectionsView() {
  const secretsQuery = useSecrets();
  const secrets = secretsQuery.data ?? [];
  const createSecret = useCreateSecret();
  const deleteSecret = useDeleteSecret();
  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);
  const connections = useStore((s) => s.mcpConnections);
  const fetchMcpConnections = useStore((s) => s.fetchMcpConnections);
  const appConnections = useStore((s) => s.appConnections);
  const appsError = useStore((s) => s.appConnectionsError);
  const fetchAppConnections = useStore((s) => s.fetchAppConnections);

  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  // MCP state
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Secret state
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [secretForm, setSecretForm] = useState(emptySecretForm);
  const [secretEnvMappings, setSecretEnvMappings] = useState<EnvMapping[]>([]);
  const [savingSecret, setSavingSecret] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretView | null>(null);

  const onecliUrl = getAuthConfig()?.onecliUrl;

  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    await Promise.all([
      fetchMcpConnections(),
      fetchAppConnections(),
      secretsQuery.refetch(),
    ]);
    loaded.current = true;
    setLoading(false);
  }, [fetchMcpConnections, fetchAppConnections, secretsQuery.refetch]);

  useEffect(() => {
    load();
  }, [load]);

  const customSecrets = secrets.filter(isCustomSecret);

  // --- MCP actions ---

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
        showToast({ kind: "error", message: data.error });
        setConnecting(false);
        return;
      }
      if (data.authUrl) {
        sessionStorage.setItem("humr-return-view", "connections");
        window.location.href = data.authUrl;
      }
    } catch (err) {
      showToast({ kind: "error", message: `Connection failed: ${err}` });
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
      showToast({ kind: "error", message: `Disconnect failed: ${err}` });
    }
    setDisconnecting(null);
  };

  // --- Secret actions ---

  const saveSecret = async () => {
    if (
      !secretForm.name.trim() ||
      !secretForm.value.trim() ||
      !secretForm.hostPattern.trim()
    )
      return;
    if (!allEnvMappingsValid(secretEnvMappings)) return;
    setSavingSecret(true);
    try {
      const mappings = sanitizeEnvMappings(secretEnvMappings);
      const pathPattern = secretForm.pathPattern.trim();
      const headerName = secretForm.headerName.trim();
      const valueFormat = secretForm.valueFormat.trim();
      await createSecret.mutateAsync({
        type: "generic",
        name: secretForm.name.trim(),
        value: secretForm.value.trim(),
        hostPattern: secretForm.hostPattern.trim(),
        ...(pathPattern.length > 0 && { pathPattern }),
        ...(headerName.length > 0 && {
          injectionConfig: {
            headerName,
            ...(valueFormat.length > 0 && { valueFormat }),
          },
        }),
        ...(mappings.length > 0 && { envMappings: mappings }),
      });
      setSecretForm(emptySecretForm);
      setSecretEnvMappings([]);
      setShowAddSecret(false);
    } finally {
      setSavingSecret(false);
    }
  };

  const removeSecret = async (id: string, name: string) => {
    if (!(await showConfirm(`Delete "${name}"?`, "Delete Secret"))) return;
    deleteSecret.mutate({ id });
  };

  const inp =
    "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-text">Connections</h1>
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
        External services and credentials available to your agents. Injected into outbound HTTP requests — agents never see raw tokens.
      </p>

      {/* Apps */}
      {onecliUrl && (
        <section className="mb-10">
          <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
            Apps
          </h2>
          <p className="text-[12px] text-text-muted mb-4">
            OAuth apps like GitHub, Google, and Slack — connect and manage in OneCLI.
          </p>

          {!loaded.current && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
            </div>
          )}

          {loaded.current && appsError && (
            <div className="rounded-xl border-2 border-danger bg-danger-light px-6 py-4 anim-in">
              <div className="text-[13px] font-semibold text-danger">
                Couldn't load app connections from OneCLI.
              </div>
              <div className="text-[11px] font-mono text-danger/80 mt-1 break-all">
                {appsError}
              </div>
            </div>
          )}

          {loaded.current && !appsError && appConnections.length === 0 && (
            <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
              No OAuth apps connected yet
            </div>
          )}

          {loaded.current && !appsError && appConnections.length > 0 && (
            <div className="flex flex-col gap-3">
              {appConnections.map((c, i) => (
                <div
                  key={c.id}
                  className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] anim-in"
                  style={{
                    boxShadow: "var(--shadow-brutal)",
                    animationDelay: `${i * 50}ms`,
                  }}
                >
                  <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
                    <KeyRound size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-text truncate">
                      {c.label}
                    </div>
                    <div className="text-[12px] font-mono text-text-muted truncate">
                      {c.identity
                        ? c.identity
                        : c.connectedAt
                          ? `Connected ${new Date(c.connectedAt).toLocaleDateString()}`
                          : c.provider}
                    </div>
                  </div>
                  <AppStatusPill status={c.status} size="md" />
                </div>
              ))}
            </div>
          )}

          {loaded.current && (
            <div className="mt-4">
              <a
                href={`${onecliUrl}/connections`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-brutal h-9 rounded-lg border-2 border-border bg-surface px-4 text-[13px] font-semibold text-text-secondary hover:text-text inline-flex items-center gap-1.5"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
              >
                Manage in OneCLI <ExternalLink size={13} />
              </a>
            </div>
          )}
        </section>
      )}

      {/* MCP Servers */}
      <section className="mb-10">
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
          MCP Servers
        </h2>
        <p className="text-[12px] text-text-muted mb-4">
          Remote tool servers connected via OAuth. They provide tools your agents can use during sessions.
        </p>

        {!loaded.current && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
          </div>
        )}

        {loaded.current && connections.length === 0 && !showAddMcp && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
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
                      setShowAddMcp(true);
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

        {loaded.current && (
          <div className="mt-4">
            <button
              onClick={() => setShowAddMcp(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-semibold text-white flex items-center gap-1.5"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            >
              <Plus size={14} /> Connect MCP Server
            </button>
          </div>
        )}
      </section>

      {/* Secrets */}
      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
          Secrets
        </h2>
        <p className="text-[12px] text-text-muted mb-4">
          Custom bearer tokens injected into outbound requests matching a host pattern.
        </p>

        {!loaded.current && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
          </div>
        )}

        {loaded.current && customSecrets.length === 0 && !showAddSecret && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No custom secrets yet
          </div>
        )}

        {loaded.current && (
          <div className="flex flex-col gap-3">
            {customSecrets.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] anim-in"
                style={{
                  boxShadow: "var(--shadow-brutal)",
                  animationDelay: `${i * 50}ms`,
                }}
              >
                <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
                  <Lock size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-text truncate">
                    {s.name}
                  </div>
                  <div className="text-[12px] font-mono text-text-muted truncate">
                    {s.hostPattern}
                    {s.pathPattern && (
                      <span className="text-text-secondary">{s.pathPattern}</span>
                    )}
                    {s.envMappings && s.envMappings.length > 0 && (
                      <>
                        {" · "}
                        <span className="text-accent">
                          {s.envMappings.map((m) => m.envName).join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 bg-surface-raised text-text-muted border-border-light">
                  Secret
                </span>
                <button
                  onClick={() => setEditingSecret(s)}
                  className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-accent hover:border-accent"
                  style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                  title="Edit"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => removeSecret(s.id, s.name)}
                  className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger"
                  style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                  title="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {loaded.current && (
          <div className="mt-4">
            <button
              onClick={() => setShowAddSecret(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-semibold text-white flex items-center gap-1.5"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            >
              <Plus size={14} /> Add Secret
            </button>
          </div>
        )}
      </section>

      {/* Connect MCP Server dialog */}
      {showAddMcp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in" onClick={() => setShowAddMcp(false)}>
          <div
            className="w-[480px] max-w-[calc(100vw-2rem)] rounded-xl border-2 border-border bg-surface p-5 md:p-7 flex flex-col gap-5 anim-scale-in"
            style={{ boxShadow: "var(--shadow-brutal)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[20px] font-bold text-text">Connect MCP Server</h2>
            <p className="text-[13px] text-text-secondary">
              Enter the URL of a remote MCP server to connect via OAuth.
            </p>
            <div className="flex gap-3">
              <input
                className={inp}
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startMcpOAuth()}
                placeholder="https://example.com/mcp"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                onClick={() => setShowAddMcp(false)}
              >
                Cancel
              </button>
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={startMcpOAuth}
                disabled={!mcpUrl.trim() || connecting}
              >
                {connecting ? "..." : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Secret dialog */}
      {showAddSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in" onClick={() => setShowAddSecret(false)}>
          <div
            className="w-[480px] max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-5 md:p-7 flex flex-col gap-5 anim-scale-in"
            style={{ boxShadow: "var(--shadow-brutal)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[20px] font-bold text-text">Add Secret</h2>
            <p className="text-[13px] text-text-secondary leading-relaxed">
              Injects a bearer token into outgoing HTTP requests whose host
              matches the pattern below.
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
                A label so you can identify this secret later.
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
                . Stored encrypted — the agent never sees the raw value.
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
                Hostname the token applies to. Supports wildcards (e.g.{" "}
                <span className="font-mono">*.example.com</span>).
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                Path Pattern (optional)
              </label>
              <input
                className={`${inp} font-mono`}
                placeholder="e.g. /v1/*"
                value={secretForm.pathPattern}
                onChange={(e) =>
                  setSecretForm((p) => ({
                    ...p,
                    pathPattern: e.target.value,
                  }))
                }
              />
              <p className="text-[11px] text-text-muted">
                Restrict injection to URL paths matching this pattern. Leave
                blank to match every path on the host.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                Header Name (optional)
              </label>
              <input
                className={`${inp} font-mono`}
                placeholder={DEFAULT_INJECTION_CONFIG.headerName}
                value={secretForm.headerName}
                onChange={(e) =>
                  setSecretForm((p) => ({ ...p, headerName: e.target.value }))
                }
              />
              <p className="text-[11px] text-text-muted">
                HTTP header OneCLI writes the secret into. Defaults to{" "}
                <span className="font-mono">
                  {DEFAULT_INJECTION_CONFIG.headerName}
                </span>
                .
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                Value Format (optional)
              </label>
              <input
                className={`${inp} font-mono`}
                placeholder={DEFAULT_INJECTION_CONFIG.valueFormat}
                value={secretForm.valueFormat}
                onChange={(e) =>
                  setSecretForm((p) => ({ ...p, valueFormat: e.target.value }))
                }
              />
              <p className="text-[11px] text-text-muted">
                Template for the header value. Use{" "}
                <span className="font-mono">{`{value}`}</span> as the token
                placeholder. Defaults to{" "}
                <span className="font-mono">
                  {DEFAULT_INJECTION_CONFIG.valueFormat}
                </span>
                .
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                Pod Env Vars (optional)
              </label>
              <p className="text-[11px] text-text-muted">
                Inject env vars into every agent instance granted this secret.
                The placeholder (typically{" "}
                <span className="font-mono">humr:sentinel</span>) is swapped
                for the real value on the wire by OneCLI.
              </p>
              <EnvMappingsEditor
                value={secretEnvMappings}
                onChange={setSecretEnvMappings}
                disabled={savingSecret}
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                onClick={() => setShowAddSecret(false)}
              >
                Cancel
              </button>
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={saveSecret}
                disabled={
                  savingSecret ||
                  !secretForm.name.trim() ||
                  !secretForm.value.trim() ||
                  !secretForm.hostPattern.trim() ||
                  !allEnvMappingsValid(secretEnvMappings)
                }
              >
                {savingSecret ? "..." : "Add Secret"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingSecret && (
        <EditSecretDialog
          secret={editingSecret}
          onClose={() => setEditingSecret(null)}
        />
      )}
    </div>
  );
}
