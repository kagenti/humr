import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { getAuthConfig } from "../../../auth.js";
import { isCustomSecret, type SecretView } from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { EditSecretDialog } from "../../secrets/components/edit-secret-dialog.js";
import { CreateSecretForm } from "../../secrets/forms/create-secret-form.js";
import { useAppConnections, useMcpConnections } from "../api/queries.js";
import { AppConnectionRow } from "../components/app-connection-row.js";
import { McpConnectionRow } from "../components/mcp-connection-row.js";
import { SecretRow } from "../components/secret-row.js";
import { AddMcpForm } from "../forms/add-mcp-form.js";

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

  const [addMcpInitialUrl, setAddMcpInitialUrl] = useState("");
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretView | null>(null);

  const onecliUrl = getAuthConfig()?.onecliUrl;
  const customSecrets = secrets.filter(isCustomSecret);

  const refreshAll = () => {
    refetchAppConnections();
    refetchMcpConnections();
    refetchSecrets();
  };
  const isFetching = isFetchingAppConnections || isFetchingMcpConnections;

  const openAddMcp = (initialUrl = "") => {
    setAddMcpInitialUrl(initialUrl);
    setShowAddMcp(true);
  };

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
                <AppConnectionRow key={c.id} connection={c} animationDelayMs={i * 50} />
              ))}
            </div>
          )}

          {!isPendingAppConnections && (
            <div className="mt-4">
              <a
                href={`${onecliUrl}/connections`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-brutal h-9 rounded-lg border-2 border-border bg-surface px-4 text-[13px] font-semibold text-text-secondary hover:text-text inline-flex items-center gap-1.5 shadow-brutal-sm"
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
              <McpConnectionRow
                key={c.hostname}
                connection={c}
                animationDelayMs={i * 50}
                onReconnect={(host) => openAddMcp(`https://${host}/mcp`)}
              />
            ))}
          </div>
        )}

        {!isPendingMcpConnections && (
          <div className="mt-4">
            <button
              onClick={() => openAddMcp()}
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
              <SecretRow
                key={s.id}
                secret={s}
                animationDelayMs={i * 50}
                onEdit={setEditingSecret}
              />
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

      {showAddMcp && (
        <AddMcpForm
          initialUrl={addMcpInitialUrl}
          onCancel={() => setShowAddMcp(false)}
        />
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
