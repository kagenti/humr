import { isProtectedAgentEnvName } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConnectionsPicker } from "../../../components/connections-picker.js";
import {
  allEnvVarsValid,
  sanitizeEnvVars,
} from "../../../components/env-vars-editor.js";
import { HoverTooltip } from "../../../components/hover-tooltip.js";
import { Modal } from "../../../components/modal.js";
import type { AgentView, EnvVar } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";
import {
  useSetAgentAccess,
  useSetAgentConnections,
  useUpdateAgent,
} from "../api/mutations.js";
import { useAgentAccess, useAgentConnections } from "../api/queries.js";
import { EnvTab, type InheritedEnv } from "../components/edit-agent-secrets/env-tab.js";
import { TabButton } from "../components/edit-agent-secrets/tab-button.js";
import {
  envsAfterUngrant,
  envsToAddOnGrant,
} from "../utils/connection-env-helpers.js";

type Tab = "connections" | "env";

export function EditAgentSecretsDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const agentId = agent.id;
  const userInitialEnv = useMemo(
    () => (agent.env ?? []).filter((e) => !isProtectedAgentEnvName(e.name)),
    [agent.env],
  );

  const { data: secrets = [] } = useSecrets();
  const { data: apps = [] } = useAppConnections();
  const accessQuery = useAgentAccess(agentId);
  const connectionsQuery = useAgentConnections(agentId);

  const updateAgent = useUpdateAgent();
  const setAccess = useSetAgentAccess();
  const setConnections = useSetAgentConnections();
  const saving = updateAgent.isPending || setAccess.isPending || setConnections.isPending;

  const [tab, setTab] = useState<Tab>("connections");
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [assignedAppIds, setAssignedAppIds] = useState<Set<string>>(new Set());
  const [envVars, setEnvVars] = useState<EnvVar[]>(userInitialEnv);

  // Initial values are snapshotted once on first data arrival so dirty-tracking
  // stays stable across this dialog session. Refetches (e.g. from a setAccess
  // mutation invalidating the query) must not reset the baseline underneath us.
  const initialsRef = useRef<{ assigned: string[]; appIds: string[] } | null>(null);
  const initialized = initialsRef.current !== null;
  useEffect(() => {
    if (initialsRef.current) return;
    if (!accessQuery.data || !connectionsQuery.data) return;
    const secretIds = [...accessQuery.data.secretIds].sort();
    const appIds = [...connectionsQuery.data.connectionIds].sort();
    initialsRef.current = { assigned: secretIds, appIds };
    setAssigned(new Set(secretIds));
    setAssignedAppIds(new Set(appIds));
  }, [accessQuery.data, connectionsQuery.data]);

  const toggleSecret = (id: string) =>
    setAssigned((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
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
    const initial = initialsRef.current?.assigned ?? [];
    const current = [...assigned].sort();
    if (current.length !== initial.length) return true;
    return current.some((id, i) => id !== initial[i]);
  }, [assigned]);

  const appsChanged = useMemo(() => {
    const initial = initialsRef.current?.appIds ?? [];
    const current = [...assignedAppIds].sort();
    if (current.length !== initial.length) return true;
    return current.some((id, i) => id !== initial[i]);
  }, [assignedAppIds]);

  const inheritedEnvs = useMemo<InheritedEnv[]>(() => {
    const items: InheritedEnv[] = (agent.env ?? [])
      .filter((e) => isProtectedAgentEnvName(e.name))
      .map((e) => ({ name: e.name, value: e.value, source: "system" as const }));

    for (const s of secrets.filter((s) => assigned.has(s.id))) {
      for (const m of s.envMappings ?? []) {
        items.push({
          name: m.envName,
          value: m.placeholder,
          source: { secretName: s.name },
        });
      }
    }

    const userEnvNames = new Set(envVars.map((e) => e.name));
    for (const a of apps.filter((a) => assignedAppIds.has(a.id))) {
      for (const m of a.envMappings ?? []) {
        if (userEnvNames.has(m.envName)) continue;
        items.push({
          name: m.envName,
          value: m.placeholder,
          source: { appLabel: a.label },
        });
      }
    }
    return items;
  }, [agent.env, secrets, assigned, apps, assignedAppIds, envVars]);

  const save = async () => {
    if (!envValid) return;
    if (!credsChanged && !envChanged && !appsChanged) {
      onClose();
      return;
    }
    try {
      if (credsChanged) {
        await setAccess.mutateAsync({
          agentName: agentId,
          mode: "selective",
          secretIds: [...assigned],
        });
      }
      if (envChanged) {
        await updateAgent.mutateAsync({ id: agentId, env: sanitizedEnv });
      }
      if (appsChanged) {
        await setConnections.mutateAsync({
          agentName: agentId,
          connectionIds: [...assignedAppIds].sort(),
        });
      }
      onClose();
    } catch {
      // Mutation meta.errorToast surfaces the failure; dialog stays open.
    }
  };

  const connectionsCount = assigned.size + assignedAppIds.size;
  const envCount = sanitizedEnv.length + inheritedEnvs.length;
  const canSave =
    !saving && initialized && envValid && (credsChanged || envChanged || appsChanged);

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
        {tab === "connections" ? (
          <ConnectionsPicker
            loading={!initialized}
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
