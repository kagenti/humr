import {
  ExternalLink,
  Globe,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Unplug,
  X,
} from "lucide-react";
import { useState } from "react";

import { getAuthConfig } from "../../../auth.js";
import { AppStatusPill } from "../../../components/app-status-pill.js";
import { useStore } from "../../../store.js";
import { isCustomSecret, type SecretView } from "../../../types.js";
import { useDeleteSecret } from "../../secrets/api/mutations.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { EditSecretDialog } from "../../secrets/components/edit-secret-dialog.js";
import { CreateSecretForm } from "../../secrets/forms/create-secret-form.js";
import { useDisconnectMcp, useStartMcpOAuth } from "../api/mutations.js";
import { useAppConnections, useMcpConnections } from "../api/queries.js";

export function ConnectionsView() {
  const {
    data: secrets = [],
    refetch: refetchSecrets,
    isPending: isPendingSecrets,
  } = useSecrets();
  const {
    data: mcpConnections = [],
    refetch: refetchMcpConnections,
    isFetching: isFetchingMcpConnections,
    isPending: isPendingMcpConnections,
  } = useMcpConnections();
  const {
    data: appConnections = [],
    error: appConnectionsError,
    refetch: refetchAppConnections,
    isFetching: isFetchingAppConnections,
    isPending: isPendingAppConnections,
  } = useAppConnections();

  const deleteSecret = useDeleteSecret();
  const startMcpOAuth = useStartMcpOAuth();
  const disconnectMcp = useDisconnectMcp();

  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);

  const [showAddMcp, setShowAddMcp] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");

  const [showAddSecret, setShowAddSecret] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretView | null>(null);

  const onecliUrl = getAuthConfig()?.onecliUrl;

  const refreshAll = () => {
    refetchAppConnections();
    refetchMcpConnections();
    refetchSecrets();
  };
  const isFetching =
    isFetchingAppConnections || isFetchingMcpConnections;

  const customSecrets = secrets.filter(isCustomSecret);

  // --- MCP actions ---

  const handleStartMcpOAuth = () => {
    const url = mcpUrl.trim();
    if (!url) return;
    startMcpOAuth.mutate(url, {
      onSuccess: (data) => {
        if (data.error) {
          showToast({ kind: "error", message: data.error });
          return;
        }
        if (data.authUrl) {
          sessionStorage.setItem("humr-return-view", "connections");
          window.location.href = data.authUrl;
        }
      },
    });
  };

  const handleDisconnectMcp = async (hostname: string) => {
    if (!(await showConfirm(`Disconnect "${hostname}"?`, "Disconnect"))) return;
    disconnectMcp.mutate(hostname);
  };

  // --- Secret actions ---

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
          onClick={refreshAll}
          className="ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal shadow-brutal-sm"
        >
          <span className={isFetching ? "anim-spin" : ""}>
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

          {isPendingAppConnections && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
            </div>
          )}

          {!isPendingAppConnections && appConnectionsError && (
            <div className="rounded-xl border-2 border-danger bg-danger-light px-6 py-4 anim-in">
              <div className="text-[13px] font-semibold text-danger">
                Couldn't load app connections from OneCLI.
              </div>
              <div className="text-[11px] font-mono text-danger/80 mt-1 break-all">
                {appConnectionsError.message}
              </div>
            </div>
          )}

          {!isPendingAppConnections && !appConnectionsError && appConnections.length === 0 && (
            <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
              No OAuth apps connected yet
            </div>
          )}

          {!isPendingAppConnections && !appConnectionsError && appConnections.length > 0 && (
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

          {!isPendingAppConnections && (
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

        {isPendingMcpConnections && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
          </div>
        )}

        {!isPendingMcpConnections && mcpConnections.length === 0 && !showAddMcp && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No MCP servers connected yet
          </div>
        )}

        {!isPendingMcpConnections && mcpConnections.length > 0 && (
          <div className="flex flex-col gap-3">
            {mcpConnections.map((c, i) => (
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
                  onClick={() => handleDisconnectMcp(c.hostname)}
                  disabled={disconnectMcp.isPending && disconnectMcp.variables === c.hostname}
                  className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger disabled:opacity-40 shadow-brutal-sm"
                  title="Disconnect"
                >
                  <Unplug size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!isPendingMcpConnections && (
          <div className="mt-4">
            <button
              onClick={() => setShowAddMcp(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-semibold text-white flex items-center gap-1.5 shadow-brutal-accent"
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

        {isPendingSecrets && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
          </div>
        )}

        {!isPendingSecrets && customSecrets.length === 0 && !showAddSecret && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No custom secrets yet
          </div>
        )}

        {!isPendingSecrets && (
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

        {!isPendingSecrets && (
          <div className="mt-4">
            <button
              onClick={() => setShowAddSecret(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-semibold text-white flex items-center gap-1.5 shadow-brutal-accent"
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
                onKeyDown={(e) => e.key === "Enter" && handleStartMcpOAuth()}
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
                className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
                onClick={handleStartMcpOAuth}
                disabled={!mcpUrl.trim() || startMcpOAuth.isPending}
              >
                {startMcpOAuth.isPending ? "..." : "Connect"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSecret && (
        <CreateSecretForm
          onCancel={() => setShowAddSecret(false)}
          onCreated={() => setShowAddSecret(false)}
        />
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
