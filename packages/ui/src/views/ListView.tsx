import { useState, useMemo, useEffect } from "react";
import { useStore } from "../store.js";
import type { InstanceView } from "../types.js";
import { isMcpSecret } from "../types.js";
import { StatusIndicator, instanceState, stateLabel, badgeColors } from "../components/StatusIndicator.js";
import { AddAgentDialog } from "../dialogs/AddAgentDialog.js";
import { CreateInstanceDialog } from "../dialogs/CreateInstanceDialog.js";
import { RefreshCw, Plus, Trash2, KeyRound } from "lucide-react";
import { EditAgentSecretsDialog } from "../dialogs/EditAgentSecretsDialog.js";

export function ListView() {
  const templates = useStore(s => s.templates);
  const agents = useStore(s => s.agents);
  const instances = useStore(s => s.instances);
  const fetchTemplates = useStore(s => s.fetchTemplates);
  const fetchAgents = useStore(s => s.fetchAgents);
  const fetchInstances = useStore(s => s.fetchInstances);
  const createAgent = useStore(s => s.createAgent);
  const deleteAgent = useStore(s => s.deleteAgent);
  const createInstance = useStore(s => s.createInstance);
  const deleteInstance = useStore(s => s.deleteInstance);
  const selectInstance = useStore(s => s.selectInstance);
  const setView = useStore(s => s.setView);
  const showConfirm = useStore(s => s.showConfirm);
  const secrets = useStore(s => s.secrets);
  const fetchSecrets = useStore(s => s.fetchSecrets);
  const agentAccess = useStore(s => s.agentAccess);
  const fetchAgentAccess = useStore(s => s.fetchAgentAccess);

  const [showAddAgent, setShowAddAgent] = useState(false);
  const [busyAgent, setBusyAgent] = useState(false);
  const [showInstDlg, setShowInstDlg] = useState<string | null>(null);
  const [busyInst, setBusyInst] = useState<string | null>(null);
  const [delAgent, setDelAgent] = useState<string | null>(null);
  const [showSecretsDlg, setShowSecretsDlg] = useState<string | null>(null);

  // Persisted across mount in the store — ensures skeleton doesn't reappear
  // when the user navigates away and back while data is already loaded.
  const loadedOnce = useStore(s => s.loadedOnce);
  const initialLoaded = loadedOnce.agents && loadedOnce.instances;

  const byAgent = useMemo(() => {
    const m = new Map<string, InstanceView[]>();
    for (const i of instances) m.set(i.agentId, [...(m.get(i.agentId) ?? []), i]);
    return m;
  }, [instances]);

  // Fetch secrets + per-agent access once we have the agent list
  useEffect(() => { fetchSecrets(); }, [fetchSecrets]);
  useEffect(() => {
    for (const a of agents) {
      if (!agentAccess[a.id]) fetchAgentAccess(a.id);
    }
  }, [agents, agentAccess, fetchAgentAccess]);

  // Count by category for a given agent based on its access mode.
  // "all" mode: counts = totals across all user secrets.
  // "selective" mode: counts = only those in the agent's assigned list.
  const countsFor = (agentId: string) => {
    const access = agentAccess[agentId];
    const pool = !access || access.mode === "all"
      ? secrets
      : secrets.filter(s => access.secretIds.includes(s.id));
    let anthropic = 0, mcp = 0, generic = 0;
    for (const s of pool) {
      if (s.type === "anthropic") anthropic += 1;
      else if (isMcpSecret(s)) mcp += 1;
      else generic += 1;
    }
    return { mode: access?.mode, anthropic, mcp, generic };
  };

  return (
    <>
      <div>
        {/* Page header */}
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-[20px] md:text-[24px] font-bold text-text">My Agents</h1>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <button
              onClick={() => { fetchTemplates(); fetchAgents(); fetchInstances(); }}
              className="btn-brutal h-9 w-9 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent"
              style={{ boxShadow: "var(--shadow-brutal-sm)" }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => setShowAddAgent(true)}
              disabled={busyAgent}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-3 md:px-5 text-[13px] font-semibold text-white disabled:opacity-40 flex items-center gap-1.5"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            >
              <Plus size={14} /> <span className="hidden sm:inline">Add</span> Agent
            </button>
          </div>
        </div>

        {/* Skeleton during initial load */}
        {!initialLoaded && (
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[120px] anim-pulse" />
            <div className="rounded-xl border-2 border-border-light bg-surface h-[120px] anim-pulse" />
          </div>
        )}

        {/* Empty state — only after initial load, only when no agents, and not mid-creation */}
        {initialLoaded && !busyAgent && agents.length === 0 && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-8 py-16 text-center">
            <p className="text-[15px] text-text-secondary mb-4">No agents yet</p>
            <button
              onClick={() => setShowAddAgent(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-semibold text-white flex items-center gap-1.5 mx-auto"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            >
              <Plus size={14} /> Add your first agent
            </button>
          </div>
        )}

        {/* Agent cards */}
        <div className="flex flex-col gap-6">
          {initialLoaded && agents.map(agent => {
            const insts = byAgent.get(agent.id) ?? [];
            return (
              <div
                key={agent.id}
                className="rounded-xl border-2 border-border bg-surface overflow-hidden anim-in transition-shadow hover:shadow-[4px_4px_0_#292524]"
                style={{ boxShadow: "var(--shadow-brutal)" }}
              >
                {/* Card header */}
                <div className="px-4 md:px-6 pt-4 md:pt-5 pb-3 md:pb-4">
                  <div className="flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-[16px] md:text-[17px] font-bold text-text">{agent.name}</h2>
                        <span className="text-[12px] font-semibold text-text-muted border-2 border-border-light rounded-full px-2.5 py-0.5">
                          {insts.length} instance{insts.length !== 1 && "s"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-info bg-info-light text-info rounded-full px-2.5 py-0.5">
                          {agent.image}
                        </span>
                        {agent.description && (
                          <span className="text-[13px] text-text-secondary">{agent.description}</span>
                        )}
                        {(() => {
                          const c = countsFor(agent.id);
                          if (c.mode === "all") {
                            return (
                              <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-accent bg-accent-light text-accent rounded-full px-2.5 py-0.5">
                                All credentials
                              </span>
                            );
                          }
                          const chips: React.ReactNode[] = [];
                          if (c.anthropic > 0) {
                            chips.push(
                              <span key="a" className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-warning bg-warning-light text-warning rounded-full px-2.5 py-0.5">
                                Anthropic
                              </span>,
                            );
                          }
                          const otherSecrets = c.generic;
                          if (otherSecrets > 0) {
                            chips.push(
                              <span key="s" className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-border-light bg-surface-raised text-text-muted rounded-full px-2.5 py-0.5">
                                {otherSecrets} secret{otherSecrets === 1 ? "" : "s"}
                              </span>,
                            );
                          }
                          if (c.mcp > 0) {
                            chips.push(
                              <span key="m" className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-accent bg-accent-light text-accent rounded-full px-2.5 py-0.5">
                                {c.mcp} MCP
                              </span>,
                            );
                          }
                          return chips;
                        })()}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <button
                        onClick={() => setShowSecretsDlg(agent.id)}
                        className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3.5 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center gap-1"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                        title="Manage agent connectors"
                      >
                        <KeyRound size={12} /> Connectors
                      </button>
                      <button
                        onClick={() => setShowInstDlg(agent.id)}
                        disabled={busyInst === agent.id}
                        className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3.5 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent disabled:opacity-40 flex items-center gap-1"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                      >
                        <Plus size={12} /> Instance
                      </button>
                      <button
                        onClick={async () => {
                          const n = insts.length;
                          const msg = n === 0 ? (
                            <>Delete agent <strong className="text-text">"{agent.name}"</strong>?</>
                          ) : (
                            <div className="space-y-2">
                              <p>Delete agent <strong className="text-text">"{agent.name}"</strong>?</p>
                              <p className="text-danger">
                                This will also delete <strong>{n} {n === 1 ? "instance" : "instances"}</strong> and <strong>all their persistent data</strong>.
                              </p>
                              <p className="text-text-muted text-[12px]">This cannot be undone.</p>
                            </div>
                          );
                          if (!await showConfirm(msg, "Delete Agent")) return;
                          setDelAgent(agent.id);
                          await deleteAgent(agent.id);
                          setDelAgent(null);
                        }}
                        disabled={delAgent === agent.id}
                        className="btn-brutal h-8 w-8 rounded-lg border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger disabled:opacity-40"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                        title="Delete agent"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Instance rows */}
                {insts.length === 0 ? (
                  <div className="border-t-2 border-border-light px-6 py-4 text-[13px] text-text-muted">
                    No instances — click "+ Instance" to create one
                  </div>
                ) : (
                  insts.map(inst => {
                    const state = instanceState(inst);
                    const clickable = state === "running" || state === "hibernated";
                    const label = stateLabel[state];
                    const colors = badgeColors[state];
                    return (
                      <div
                        key={inst.id}
                        onClick={clickable ? () => selectInstance(inst.id) : undefined}
                        className={`flex items-center gap-3 md:gap-4 border-t-2 border-border-light px-4 md:px-6 py-3 md:py-3.5 min-h-[44px] transition-colors ${clickable ? "cursor-pointer hover:bg-accent-light" : "opacity-50"}`}
                      >
                        <StatusIndicator state={state} />
                        <span className="text-[14px] font-semibold text-text">{inst.name}</span>
                        <span className={`inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 ${colors}`}>
                          {label}
                        </span>

                        <span className="flex-1" />

                        <button
                          onClick={async e => { e.stopPropagation(); if (await showConfirm(`Delete instance "${inst.name}"?`, "Delete Instance")) deleteInstance(inst.id); }}
                          className="h-7 w-7 rounded-md border-2 border-border-light flex items-center justify-center text-text-muted hover:text-danger hover:border-danger transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showAddAgent && (
        <AddAgentDialog
          templates={templates}
          onSubmit={async (input) => { setShowAddAgent(false); setBusyAgent(true); await createAgent(input); setBusyAgent(false); }}
          onCancel={() => setShowAddAgent(false)}
          onGoToConnectors={() => { setShowAddAgent(false); setView("connectors"); }}
        />
      )}
      {showInstDlg && (
        <CreateInstanceDialog
          agentName={agents.find(a => a.id === showInstDlg)?.name ?? showInstDlg}
          onSubmit={async (name) => { const aid = showInstDlg; setShowInstDlg(null); setBusyInst(aid); await createInstance(aid, name); setBusyInst(null); }}
          onCancel={() => setShowInstDlg(null)}
        />
      )}
      {showSecretsDlg && (
        <EditAgentSecretsDialog
          agentId={showSecretsDlg}
          agentName={agents.find(a => a.id === showSecretsDlg)?.name ?? showSecretsDlg}
          onClose={() => setShowSecretsDlg(null)}
        />
      )}
    </>
  );
}
