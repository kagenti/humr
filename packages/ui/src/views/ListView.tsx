import { useState, useMemo } from "react";
import { useStore } from "../store.js";
import type { InstanceView } from "../types.js";
import { StatusIndicator, instanceState, stateLabel, badgeColors } from "../components/StatusIndicator.js";
import { AddAgentDialog } from "../dialogs/AddAgentDialog.js";
import { CreateInstanceDialog } from "../dialogs/CreateInstanceDialog.js";
import { RefreshCw, Plus, Trash2, MessageSquare, MessageSquareOff } from "lucide-react";
import { ConnectSlackDialog } from "../dialogs/ConnectSlackDialog.js";

export function ListView() {
  const templates = useStore(s => s.templates);
  const agents = useStore(s => s.agents);
  const instances = useStore(s => s.instances);
  const loading = useStore(s => s.loading);
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
  const connectSlack = useStore(s => s.connectSlack);
  const disconnectSlack = useStore(s => s.disconnectSlack);
  const slackAvailable = useStore(s => !!s.availableChannels.slack);

  const [showAddAgent, setShowAddAgent] = useState(false);
  const [busyAgent, setBusyAgent] = useState(false);
  const [showInstDlg, setShowInstDlg] = useState<string | null>(null); // agent id
  const [busyInst, setBusyInst] = useState<string | null>(null);
  const [delAgent, setDelAgent] = useState<string | null>(null);
  const [showSlackDlg, setShowSlackDlg] = useState<string | null>(null);

  const byAgent = useMemo(() => {
    const m = new Map<string, InstanceView[]>();
    for (const i of instances) m.set(i.agentId, [...(m.get(i.agentId) ?? []), i]);
    return m;
  }, [instances]);

  return (
    <>
      <div>
        {/* Page header */}
        <div className="flex items-center mb-8">
          <h1 className="text-[24px] font-bold text-text">My Agents</h1>
          <div className="ml-auto flex items-center gap-3">
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
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-semibold text-white disabled:opacity-40 flex items-center gap-1.5"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            >
              <Plus size={14} /> Add Agent
            </button>
          </div>
        </div>

        {/* Empty state (only when not loading) */}
        {!loading.agents && !loading.instances && agents.length === 0 && (
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
          {agents.map(agent => {
            const insts = byAgent.get(agent.id) ?? [];
            return (
              <div
                key={agent.id}
                className="rounded-xl border-2 border-border bg-surface overflow-hidden anim-in transition-shadow hover:shadow-[4px_4px_0_#292524]"
                style={{ boxShadow: "var(--shadow-brutal)" }}
              >
                {/* Card header */}
                <div className="px-6 pt-5 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-[17px] font-bold text-text">{agent.name}</h2>
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
                        {agent.mcpServers && Object.keys(agent.mcpServers).length > 0 && (
                          <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-accent bg-accent-light text-accent rounded-full px-2.5 py-0.5">
                            {Object.keys(agent.mcpServers).length} MCP
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setShowInstDlg(agent.id)}
                        disabled={busyInst === agent.id}
                        className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3.5 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent disabled:opacity-40 flex items-center gap-1"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                      >
                        <Plus size={12} /> Instance
                      </button>
                      <button
                        onClick={async () => { if (!await showConfirm(`Delete agent "${agent.name}"?`, "Delete Agent")) return; setDelAgent(agent.id); await deleteAgent(agent.id); setDelAgent(null); }}
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
                        className={`flex items-center gap-4 border-t-2 border-border-light px-6 py-3.5 transition-colors ${clickable ? "cursor-pointer hover:bg-accent-light" : "opacity-50"}`}
                      >
                        <StatusIndicator state={state} />
                        <span className="text-[14px] font-semibold text-text">{inst.name}</span>
                        <span className={`inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 ${colors}`}>
                          {label}
                        </span>

                        <span className="flex-1" />

                        {inst.enabledMcpServers && inst.enabledMcpServers.length > 0 && (
                          <span className="text-[12px] font-mono text-text-muted">{inst.enabledMcpServers.length} MCP</span>
                        )}

                        {slackAvailable && (
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            if (inst.channels.some(c => c.type === "slack")) {
                              if (await showConfirm(`Disconnect Slack from "${inst.name}"?`, "Disconnect Slack")) disconnectSlack(inst.id);
                            } else {
                              setShowSlackDlg(inst.id);
                            }
                          }}
                          className={`h-7 w-7 rounded-md border-2 flex items-center justify-center transition-colors ${inst.channels.some(c => c.type === "slack") ? "border-accent text-accent hover:text-danger hover:border-danger" : "border-border-light text-text-muted hover:text-accent hover:border-accent"}`}
                          title={inst.channels.some(c => c.type === "slack") ? "Disconnect Slack" : "Connect Slack"}
                        >
                          {inst.channels.some(c => c.type === "slack") ? <MessageSquareOff size={12} /> : <MessageSquare size={12} />}
                        </button>
                        )}
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
          mcpServers={agents.find(a => a.id === showInstDlg)?.mcpServers}
          onSubmit={async (name, mcp) => { const aid = showInstDlg; setShowInstDlg(null); setBusyInst(aid); await createInstance(aid, name, mcp); setBusyInst(null); }}
          onCancel={() => setShowInstDlg(null)}
        />
      )}
      {showSlackDlg && (
        <ConnectSlackDialog
          instanceName={showSlackDlg}
          onSubmit={async (botToken: string) => { const n = showSlackDlg; setShowSlackDlg(null); await connectSlack(n, botToken); }}
          onCancel={() => setShowSlackDlg(null)}
        />
      )}
    </>
  );
}
