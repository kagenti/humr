import { useState, useEffect, useMemo, useRef } from "react";
import {
  isProtectedAgentEnvName,
  type AppConnectionView,
  type SecretView,
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
  envsAfterUngrant,
  envsToAddOnGrant,
} from "./connection-env-helpers.js";
import { ConnectionsPicker } from "../components/connections-picker.js";
import { HoverTooltip } from "../components/hover-tooltip.js";
import { KeyRound, Lock } from "lucide-react";

type Tab = "connections" | "env";

interface InheritedEnv {
  name: string;
  value: string;
  source: "system" | { secretName: string };
}

export function EditAgentSecretsDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const agentId = agent.id;
  const updateAgent = useStore((s) => s.updateAgent);
  const initialEnv = agent.env ?? [];
  const userInitialEnv = initialEnv.filter((e) => !isProtectedAgentEnvName(e.name));

  const [tab, setTab] = useState<Tab>("connections");
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [apps, setApps] = useState<AppConnectionView[]>([]);
  const [assignedAppIds, setAssignedAppIds] = useState<Set<string>>(new Set());
  const [initialAssigned, setInitialAssigned] = useState<string[]>([]);
  const initialAppIds = useRef<string[]>([]);
  const [envVars, setEnvVars] = useState<EnvVar[]>(userInitialEnv);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const toggleSecret = (id: string) =>
    setAssigned((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleApp = (id: string) =>
    setAssignedAppIds((p) => {
      const n = new Set(p);
      const app = apps.find((a) => a.id === id);
      if (n.has(id)) {
        n.delete(id);
        const remaining = apps.filter((a) => n.has(a.id));
        setEnvVars((prev) => envsAfterUngrant(prev, app, remaining));
      } else {
        n.add(id);
        // Grant-time populate: copy the app's declared envMappings into the
        // editable env list. Functional updater reads fresh state so rapid
        // double-grants can't race the dedupe.
        setEnvVars((prev) => {
          const toAdd = envsToAddOnGrant(prev, app);
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
      return n;
    });

  const sanitizedEnv = sanitizeEnvVars(envVars);
  const envChanged =
    JSON.stringify(sanitizedEnv) !== JSON.stringify(userInitialEnv);
  const envValid = allEnvVarsValid(envVars);

  const credsChanged = useMemo(() => {
    const current = [...assigned].sort();
    if (current.length !== initialAssigned.length) return true;
    return current.some((id, i) => id !== initialAssigned[i]);
  }, [assigned, initialAssigned]);

  const appsChanged = useMemo(() => {
    const current = [...assignedAppIds].sort();
    if (current.length !== initialAppIds.current.length) return true;
    return current.some((id, i) => id !== initialAppIds.current[i]);
  }, [assignedAppIds]);

  const inheritedEnvs = useMemo<InheritedEnv[]>(() => {
    const items: InheritedEnv[] = initialEnv
      .filter((e) => isProtectedAgentEnvName(e.name))
      .map((e) => ({ name: e.name, value: e.value, source: "system" as const }));

    const grantedSecrets = secrets.filter((s) => assigned.has(s.id));
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
  }, [initialEnv, secrets, assigned]);

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
          mode: "selective",
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
        setError(`Connections saved; apps failed: ${err?.message ?? String(err)}`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onClose();
  };

  const connectionsCount = assigned.size + assignedAppIds.size;
  const envCount = sanitizedEnv.length + inheritedEnvs.length;

  const canSave =
    !saving && !loading && envValid && (credsChanged || envChanged || appsChanged);

  return (
    <Modal onClose={onClose} widthClass="w-[640px]">
      <div className="px-7 pt-7 pb-4 border-b-2 border-border-light">
          <h2 className="text-[20px] font-bold text-text">Configure Agent</h2>
          <p className="text-[12px] text-text-muted mt-1">
            {agent.templateId ? (
              <>
                Template:{" "}
                <HoverTooltip
                  placement="right"
                  trigger={
                    <span className="font-semibold text-text-secondary border-b border-dotted border-text-muted cursor-help">
                      {agent.templateId}
                    </span>
                  }
                >
                  <span className="font-mono">{agent.image}</span>
                </HoverTooltip>
              </>
            ) : (
              <>
                Image:{" "}
                <span className="font-mono text-text-secondary break-all">
                  {agent.image}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="px-7 pt-4 flex items-center gap-1 border-b-2 border-border-light">
          <TabButton
            active={tab === "connections"}
            label="Connections"
            count={connectionsCount}
            onClick={() => setTab("connections")}
          />
          <TabButton
            active={tab === "env"}
            label="Environment"
            count={envCount}
            onClick={() => setTab("env")}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-4">
          {error && (
            <div className="rounded-lg border-2 border-danger bg-danger-light px-4 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}

          {tab === "connections" ? (
            <ConnectionsPicker
              loading={loading}
              secrets={secrets}
              apps={apps}
              selSecrets={assigned}
              selApps={assignedAppIds}
              onToggleSecret={toggleSecret}
              onToggleApp={toggleApp}
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
  label,
  count,
  onClick,
}: {
  active: boolean;
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
        title={isSystem ? "Platform-managed" : `From connection: ${sourceName}`}
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
