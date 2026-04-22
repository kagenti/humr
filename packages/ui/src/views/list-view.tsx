import { useState, useMemo } from "react";
import { useStore } from "../store.js";
import { StatusBadge } from "../components/status-indicator.js";
import { resolveAgentDisplay } from "../components/agent-resolver.js";
import { AddAgentDialog } from "../dialogs/add-agent-dialog.js";
import { RefreshCw, Plus, Trash2, KeyRound, RotateCw, Play } from "lucide-react";
import { EditAgentSecretsDialog } from "../dialogs/edit-agent-secrets-dialog.js";

export function ListView() {
  const templates = useStore(s => s.templates);
  const agents = useStore(s => s.agents);
  const instances = useStore(s => s.instances);
  const restartingInstances = useStore(s => s.restartingInstances);
  const fetchTemplates = useStore(s => s.fetchTemplates);
  const fetchAgents = useStore(s => s.fetchAgents);
  const fetchInstances = useStore(s => s.fetchInstances);
  const createAgent = useStore(s => s.createAgent);
  const deleteAgent = useStore(s => s.deleteAgent);
  const restartInstance = useStore(s => s.restartInstance);
  const wakeInstance = useStore(s => s.wakeInstance);
  const selectInstance = useStore(s => s.selectInstance);
  const setView = useStore(s => s.setView);
  const showConfirm = useStore(s => s.showConfirm);

  const [showAddAgent, setShowAddAgent] = useState(false);
  const [busyAgent, setBusyAgent] = useState(false);
  const [delAgent, setDelAgent] = useState<string | null>(null);
  const [showSecretsDlg, setShowSecretsDlg] = useState<string | null>(null);

  const loadedOnce = useStore(s => s.loadedOnce);
  const initialLoaded = loadedOnce.agents && loadedOnce.instances;

  const restartingIds = useMemo(
    () => new Set(restartingInstances.keys()),
    [restartingInstances],
  );

  return (
    <>
      <div>
        {/* Page header */}
        <div className="flex items-center gap-3 mb-8">
          <h1 className="text-[20px] md:text-[24px] font-bold text-text">Agents</h1>
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

        {/* Skeleton during initial load — only when we expect agents */}
        {!initialLoaded && agents.length > 0 && (
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[88px] anim-pulse" />
            <div className="rounded-xl border-2 border-border-light bg-surface h-[88px] anim-pulse" />
          </div>
        )}

        {/* Empty state — consistent placeholder when no agents exist */}
        {initialLoaded && agents.length === 0 && !busyAgent && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No agents yet
          </div>
        )}

        {/* One row per agent — the 1:N agent→instance cardinality is hidden. */}
        <div className="flex flex-col gap-6">
          {initialLoaded && agents.map(agent => {
            const display = resolveAgentDisplay(agent, instances, restartingIds);
            const inst = display.instance;
            const onOpen = () => { if (inst && display.clickable) selectInstance(inst.id); };
            return (
              <div
                key={agent.id}
                onClick={onOpen}
                className={`rounded-xl border-2 border-border bg-surface overflow-hidden anim-in shadow-[var(--shadow-brutal)] transition-shadow ${display.clickable ? "group cursor-pointer hover:not-has-[button:hover]:shadow-[4px_4px_0_#292524]" : ""}`}
              >
                <div className="px-4 md:px-6 py-4 md:py-5">
                  <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h2 className="text-[16px] md:text-[17px] font-bold text-text transition-colors [.group:hover:not(:has(button:hover))_&]:text-accent">{agent.name}</h2>
                        <StatusBadge state={display.state} />
                      </div>
                      {agent.description && (
                        <p className="text-[13px] text-text-secondary">{agent.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (!inst) return;
                          if (display.powerAction === "start") wakeInstance(inst.id);
                          else if (display.powerAction === "restart") restartInstance(inst.id);
                        }}
                        disabled={display.powerAction === null}
                        className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3.5 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent disabled:opacity-40 disabled:hover:text-text-secondary disabled:hover:border-border flex items-center gap-1"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                        title={display.powerAction === "start" ? "Wake the hibernated agent" : "Restart the agent pod"}
                      >
                        {display.powerAction === "start"
                          ? (<><Play size={12} /> Start</>)
                          : (<><RotateCw size={12} /> Restart</>)}
                      </button>
                      <button
                        onClick={() => setShowSecretsDlg(agent.id)}
                        className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3.5 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center gap-1"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                        title="Configure agent credentials and env vars"
                      >
                        <KeyRound size={12} /> Configure
                      </button>
                      <button
                        onClick={async () => {
                          const msg = (
                            <div className="space-y-2">
                              <p>Delete agent <strong className="text-text">"{agent.name}"</strong>?</p>
                              <p className="text-danger">
                                This will also delete <strong>all persistent data</strong>.
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
          onGoToProviders={() => { setShowAddAgent(false); setView("providers"); }}
        />
      )}
      {showSecretsDlg &&
        (() => {
          const agent = agents.find((a) => a.id === showSecretsDlg);
          if (!agent) return null;
          return (
            <EditAgentSecretsDialog
              agent={agent}
              onClose={() => setShowSecretsDlg(null)}
            />
          );
        })()}
    </>
  );
}
