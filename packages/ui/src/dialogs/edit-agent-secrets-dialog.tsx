import { useState, useEffect, useMemo, useRef } from "react";
import {
  isProtectedAgentEnvName,
  type AppConnectionView,
  type SecretView,
  type SecretMode,
} from "api-server-api";
import { useStore } from "../store.js";
import type { AgentView, EnvVar } from "../types.js";
import { platform } from "../platform.js";
import { Modal } from "../components/modal.js";
import {
  EnvVarsEditor,
  allEnvVarsValid,
  sanitizeEnvVars,
} from "../components/env-vars-editor.js";
import {
  Lock,
  Sparkles,
  Globe,
  Search,
  Terminal,
  KeyRound,
  ShieldCheck,
} from "lucide-react";

interface InheritedEnv {
  name: string;
  value: string;
  source: "system" | { secretName: string };
}

type Tab = "credentials" | "env";

export function EditAgentSecretsDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const agentId = agent.id;
  const agentName = agent.name;
  const updateAgent = useStore((s) => s.updateAgent);
  const initialEnv = agent.env ?? [];
  const userInitialEnv = initialEnv.filter((e) => !isProtectedAgentEnvName(e.name));

  const [tab, setTab] = useState<Tab>("credentials");
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [mode, setMode] = useState<SecretMode>("selective");
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [apps, setApps] = useState<AppConnectionView[]>([]);
  const [assignedAppIds, setAssignedAppIds] = useState<Set<string>>(new Set());
  const [initialMode, setInitialMode] = useState<SecretMode>("selective");
  const [initialAssigned, setInitialAssigned] = useState<string[]>([]);
  const initialAppIds = useRef<string[]>([]);
  const [envVars, setEnvVars] = useState<EnvVar[]>(userInitialEnv);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [secs, access, appList, agentApps] = await Promise.all([
          platform.secrets.list.query(),
          platform.secrets.getAgentAccess.query({ agentName: agentId }),
          platform.connections.list.query().catch(() => [] as AppConnectionView[]),
          platform.connections.getAgentConnections
            .query({ agentName: agentId })
            .catch(() => ({ connectionIds: [] as string[] })),
        ]);
        if (cancelled) return;
        setSecrets(secs);
        setMode(access.mode);
        setInitialMode(access.mode);
        const secretIds = [...access.secretIds].sort();
        setAssigned(new Set(secretIds));
        setInitialAssigned(secretIds);
        setApps(appList);
        setAssignedAppIds(new Set(agentApps.connectionIds));
        initialAppIds.current = [...agentApps.connectionIds].sort();
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const toggle = (id: string) =>
    setAssigned((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleApp = (id: string) =>
    setAssignedAppIds((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const selectAll = () => setAssigned(new Set(filtered.map((s) => s.id)));
  const clearAll = () => setAssigned(new Set());

  const sanitizedEnv = sanitizeEnvVars(envVars);
  const envChanged =
    JSON.stringify(sanitizedEnv) !== JSON.stringify(userInitialEnv);
  const envValid = allEnvVarsValid(envVars);

  const credsChanged = useMemo(() => {
    if (mode !== initialMode) return true;
    const current = [...assigned].sort();
    if (current.length !== initialAssigned.length) return true;
    return current.some((id, i) => id !== initialAssigned[i]);
  }, [mode, initialMode, assigned, initialAssigned]);

  const appsChanged = useMemo(() => {
    const current = [...assignedAppIds].sort();
    if (current.length !== initialAppIds.current.length) return true;
    return current.some((id, i) => id !== initialAppIds.current[i]);
  }, [assignedAppIds]);

  const inheritedEnvs = useMemo<InheritedEnv[]>(() => {
    const items: InheritedEnv[] = initialEnv
      .filter((e) => isProtectedAgentEnvName(e.name))
      .map((e) => ({ name: e.name, value: e.value, source: "system" as const }));

    const grantedSecrets =
      mode === "all" ? secrets : secrets.filter((s) => assigned.has(s.id));
    for (const s of grantedSecrets) {
      for (const m of s.envMappings ?? []) {
        items.push({
          name: m.envName,
          value: m.placeholder,
          source: { secretName: s.name },
        });
      }
    }
    return items;
  }, [initialEnv, mode, secrets, assigned]);

  const save = async () => {
    if (!envValid) return;
    const nextAppIds = [...assignedAppIds].sort();
    if (!credsChanged && !envChanged && !appsChanged) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (credsChanged) {
        await platform.secrets.setAgentAccess.mutate({
          agentName: agentId,
          mode,
          secretIds: [...assigned],
        });
      }
      if (envChanged) {
        await updateAgent(agentId, { env: sanitizedEnv });
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
      setSaving(false);
      return;
    }

    if (appsChanged) {
      try {
        await platform.connections.setAgentConnections.mutate({
          agentName: agentId,
          connectionIds: nextAppIds,
        });
        initialAppIds.current = nextAppIds;
      } catch (err: any) {
        setError(`Secrets saved; apps failed: ${err?.message ?? String(err)}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onClose();
  };

  const classify = (s: SecretView): "anthropic" | "mcp" | "secret" => {
    if (s.type === "anthropic") return "anthropic";
    if (s.name.startsWith("__humr_mcp:")) return "mcp";
    return "secret";
  };

  const displayName = (s: SecretView): string => {
    if (s.name.startsWith("__humr_mcp:")) return s.name.slice("__humr_mcp:".length);
    return s.name;
  };

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? secrets.filter((s) =>
        displayName(s).toLowerCase().includes(q) ||
        s.hostPattern.toLowerCase().includes(q),
      )
    : secrets;

  const selectedCount = filtered.filter((s) => assigned.has(s.id)).length;
  const grantedCount = mode === "all" ? secrets.length : assigned.size;
  const userEnvCount = sanitizedEnv.length;

  const canSave =
    !saving && !loading && envValid && (credsChanged || envChanged || appsChanged);

  return (
    <Modal onClose={onClose} widthClass="w-[640px]">
      <div className="px-7 pt-7 pb-4 border-b-2 border-border-light">
          <h2 className="text-[20px] font-bold text-text">Configure Agent</h2>
          <p className="text-[12px] text-text-muted mt-1">
            Settings for{" "}
            <span className="font-semibold text-text-secondary">{agentName}</span>.
            Changes apply to every instance on next pod restart.
          </p>
        </div>

        <div className="px-7 pt-4 flex items-center gap-1 border-b-2 border-border-light">
          <TabButton
            active={tab === "credentials"}
            icon={<ShieldCheck size={13} />}
            label="Credentials"
            count={grantedCount}
            onClick={() => setTab("credentials")}
          />
          <TabButton
            active={tab === "env"}
            icon={<Terminal size={13} />}
            label="Environment"
            count={userEnvCount + inheritedEnvs.length}
            onClick={() => setTab("env")}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border-2 border-danger bg-danger-light px-4 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}

          {tab === "credentials" ? (
            <CredentialsTab
              loading={loading}
              mode={mode}
              setMode={setMode}
              secrets={secrets}
              filtered={filtered}
              filter={filter}
              setFilter={setFilter}
              assigned={assigned}
              toggle={toggle}
              selectAll={selectAll}
              clearAll={clearAll}
              classify={classify}
              displayName={displayName}
              selectedCount={selectedCount}
              totalCount={filtered.length}
              apps={apps}
              assignedAppIds={assignedAppIds}
              toggleApp={toggleApp}
            />
          ) : (
            <EnvTab
              inherited={inheritedEnvs}
              envVars={envVars}
              setEnvVars={setEnvVars}
              saving={saving}
            />
          )}
        </div>

        <div className="px-7 py-4 border-t-2 border-border-light flex justify-end gap-3">
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
            style={{ boxShadow: "var(--shadow-brutal-sm)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            onClick={save}
            disabled={!canSave}
            title={!credsChanged && !envChanged && !appsChanged ? "Nothing to save" : undefined}
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
    </Modal>
  );
}

function TabButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-10 px-4 text-[13px] font-semibold inline-flex items-center gap-2 border-b-2 -mb-[2px] transition-colors ${
        active
          ? "text-accent border-accent"
          : "text-text-muted border-transparent hover:text-text"
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span
          className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${
            active ? "bg-accent text-white" : "bg-surface-raised text-text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function CredentialsTab({
  loading,
  mode,
  setMode,
  secrets,
  filtered,
  filter,
  setFilter,
  assigned,
  toggle,
  selectAll,
  clearAll,
  classify,
  displayName,
  selectedCount,
  totalCount,
  apps,
  assignedAppIds,
  toggleApp,
}: {
  loading: boolean;
  mode: SecretMode;
  setMode: (m: SecretMode) => void;
  secrets: SecretView[];
  filtered: SecretView[];
  filter: string;
  setFilter: (v: string) => void;
  assigned: Set<string>;
  toggle: (id: string) => void;
  selectAll: () => void;
  clearAll: () => void;
  classify: (s: SecretView) => "anthropic" | "mcp" | "secret";
  displayName: (s: SecretView) => string;
  selectedCount: number;
  totalCount: number;
  apps: AppConnectionView[];
  assignedAppIds: Set<string>;
  toggleApp: (id: string) => void;
}) {
  return (
    <>
      <p className="text-[12px] text-text-muted">
        OneCLI injects credentials into outbound requests when the destination
        host matches. Values stay in OneCLI — the agent never sees them.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <ModeCard
          active={mode === "all"}
          icon={<Globe size={16} />}
          title="All credentials"
          description="Any matching credential"
          onClick={() => setMode("all")}
        />
        <ModeCard
          active={mode === "selective"}
          icon={<Lock size={16} />}
          title="Selective"
          description="Only credentials you pick"
          onClick={() => setMode("selective")}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          <div className="h-8 rounded-lg bg-surface-raised anim-pulse" />
          <div className="h-14 rounded-lg bg-surface-raised anim-pulse" />
          <div className="h-14 rounded-lg bg-surface-raised anim-pulse" />
        </div>
      ) : mode === "all" ? (
        <div className="rounded-lg border-2 border-border-light bg-surface-raised px-5 py-6 text-center">
          <p className="text-[13px] text-text-secondary">
            OneCLI may inject any of your{" "}
            <strong>{secrets.length} credentials</strong> when the destination
            host matches.
          </p>
          <p className="text-[11px] text-text-muted mt-1">
            Switch to <em>Selective</em> to restrict the set.
          </p>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              className="w-full h-9 rounded-lg border-2 border-border-light bg-bg pl-9 pr-4 text-[13px] text-text outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
              placeholder="Filter credentials..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="flex items-center text-[11px] text-text-muted">
            <span>
              <strong className="text-text">{selectedCount}</strong> of{" "}
              {totalCount} selected
            </span>
            <span className="ml-auto flex gap-3">
              <button
                className="hover:text-accent font-semibold"
                onClick={selectAll}
              >
                Select all
              </button>
              <span>·</span>
              <button
                className="hover:text-accent font-semibold"
                onClick={clearAll}
              >
                Clear
              </button>
            </span>
          </div>

          {filtered.length === 0 && (
            <span className="text-[12px] text-text-muted text-center py-4">
              {filter
                ? "No matching credentials"
                : "No credentials yet — add some on the Connectors page"}
            </span>
          )}
          <div className="flex flex-col gap-2">
            {filtered.map((s) => {
              const kind = classify(s);
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent ${
                    assigned.has(s.id)
                      ? "border-accent bg-accent-light"
                      : "border-border-light"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)] w-4 h-4"
                    checked={assigned.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  {kind === "anthropic" && (
                    <Sparkles size={14} className="text-warning shrink-0" />
                  )}
                  {kind === "mcp" && (
                    <Globe size={14} className="text-info shrink-0" />
                  )}
                  {kind === "secret" && (
                    <Lock size={14} className="text-text-secondary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text truncate">
                      {displayName(s)}
                    </div>
                    <div className="text-[11px] font-mono text-text-muted truncate">
                      {s.hostPattern}
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
                  {kind !== "anthropic" && (
                    <span
                      className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 shrink-0 ${
                        kind === "mcp"
                          ? "bg-info-light text-info border-info"
                          : "bg-surface-raised text-text-muted border-border-light"
                      }`}
                    >
                      {kind === "mcp" ? "MCP" : "Secret"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </>
      )}

      {!loading && (
        <AppsGroup apps={apps} assignedIds={assignedAppIds} onToggle={toggleApp} />
      )}
    </>
  );
}

function EnvTab({
  inherited,
  envVars,
  setEnvVars,
  saving,
}: {
  inherited: InheritedEnv[];
  envVars: EnvVar[];
  setEnvVars: (v: EnvVar[]) => void;
  saving: boolean;
}) {
  return (
    <>
      <p className="text-[12px] text-text-muted">
        Applied to every instance of this agent. Restart the instance pod to
        pick up changes.
      </p>

      {inherited.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em]">
              Inherited
            </span>
            <span className="text-[10px] text-text-muted">
              · managed elsewhere
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {inherited.map((e, i) => (
              <InheritedEnvRow key={`${e.name}:${i}`} entry={e} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em]">
          Custom
        </span>
        <EnvVarsEditor value={envVars} onChange={setEnvVars} disabled={saving} />
      </div>
    </>
  );
}

function InheritedEnvRow({ entry }: { entry: InheritedEnv }) {
  const isSystem = entry.source === "system";
  const sourceName = entry.source === "system" ? null : entry.source.secretName;
  return (
    <div className="group flex items-center gap-2 rounded-md border-2 border-border-light bg-surface-raised px-3 py-1.5 text-[12px]">
      <span
        className={`shrink-0 ${isSystem ? "text-text-muted" : "text-accent"}`}
        title={isSystem ? "Platform-managed" : `From connector: ${sourceName}`}
      >
        {isSystem ? <Lock size={12} /> : <KeyRound size={12} />}
      </span>
      <span className="font-mono font-semibold text-text truncate">
        {entry.name}
      </span>
      <span className="text-text-muted">=</span>
      <span className="font-mono text-text-muted truncate flex-1" title={entry.value}>
        {entry.value}
      </span>
      {!isSystem && (
        <span className="text-[10px] text-text-muted italic truncate max-w-[160px]">
          {sourceName}
        </span>
      )}
    </div>
  );
}

function AppsGroup({
  apps,
  assignedIds,
  onToggle,
}: {
  apps: AppConnectionView[];
  assignedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (apps.length === 0 && assignedIds.size === 0) return null;
  // Stale IDs: assigned upstream but no longer in the connections list
  // (e.g. connection revoked in OneCLI while the agent still has the grant).
  // Rendering them keeps "uncheck to unassign" working as the recovery path.
  const knownIds = new Set(apps.map((a) => a.id));
  const staleIds = [...assignedIds].filter((id) => !knownIds.has(id));
  return (
    <div>
      <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
        Apps
      </div>
      <p className="text-[11px] text-text-muted mb-2">
        OAuth apps this agent can use. Connect new apps in OneCLI.
      </p>
      <div className="flex flex-col gap-2">
        {apps.map((app) => (
          <AppRow
            key={app.id}
            id={app.id}
            label={app.label}
            identity={app.identity}
            status={app.status}
            checked={assignedIds.has(app.id)}
            onToggle={onToggle}
          />
        ))}
        {staleIds.map((id) => (
          <AppRow
            key={id}
            id={id}
            label="Unavailable app"
            identity={id}
            status={undefined}
            checked={assignedIds.has(id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function AppRow({
  id,
  label,
  identity,
  status,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  identity?: string;
  status: AppConnectionView["status"] | undefined;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent ${checked ? "border-accent bg-accent-light" : "border-border-light"}`}
    >
      <input
        type="checkbox"
        className="accent-[var(--color-accent)] w-4 h-4"
        checked={checked}
        onChange={() => onToggle(id)}
      />
      <KeyRound size={14} className="text-text-secondary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">{label}</div>
        {identity && (
          <div className="text-[11px] font-mono text-text-muted truncate">
            {identity}
          </div>
        )}
      </div>
      <span
        className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 shrink-0 ${
          !status || status === "unknown"
            ? "bg-surface-raised text-text-muted border-border-light"
            : status === "expired"
              ? "bg-danger-light text-danger border-danger"
              : status === "disconnected"
                ? "bg-surface-raised text-text-muted border-border-light"
                : "bg-info-light text-info border-info"
        }`}
      >
        {!status
          ? "Unresolved"
          : status === "expired"
            ? "Expired"
            : status === "disconnected"
              ? "Disconnected"
              : status === "unknown"
                ? "Unknown"
                : "Connected"}
      </span>
    </label>
  );
}

function ModeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border-2 p-3.5 text-left flex flex-col gap-1.5 transition-colors ${
        active
          ? "border-accent bg-accent-light"
          : "border-border-light bg-bg hover:border-border"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`w-7 h-7 rounded-md border-2 flex items-center justify-center ${
            active
              ? "bg-accent text-white border-accent-hover"
              : "bg-surface border-border-light text-text-secondary"
          }`}
        >
          {icon}
        </div>
      </div>
      <div>
        <div className="text-[13px] font-bold text-text">{title}</div>
        <div className="text-[11px] text-text-muted">{description}</div>
      </div>
    </button>
  );
}
