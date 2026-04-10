import { useState, useMemo } from "react";
import { useStore } from "../store.js";
import type { InstanceView } from "../types.js";
import { StatusIndicator } from "../components/StatusIndicator.js";
import { CreateTemplateDialog } from "../dialogs/CreateTemplateDialog.js";
import { CreateInstanceDialog } from "../dialogs/CreateInstanceDialog.js";
import { RefreshCw, Plus, Trash2, MessageSquare, MessageSquareOff } from "lucide-react";
import { ConnectSlackDialog } from "../dialogs/ConnectSlackDialog.js";

function statusLabel(i: InstanceView) {
  if (!i.status) return "unknown";
  if (i.status.podReady) return i.status.currentState;
  return i.status.currentState === "running" ? "starting" : i.status.currentState;
}

function statusState(i: InstanceView) {
  if (i.status?.podReady) return "ready";
  if (i.status?.currentState === "error") return "error";
  if (i.desiredState === "hibernated" || i.status?.currentState === "hibernated") return "hibernated";
  return "running";
}

const badgeColors: Record<string, string> = {
  ready: "bg-success-light text-success border-success",
  running: "bg-warning-light text-warning border-warning",
  starting: "bg-warning-light text-warning border-warning",
  error: "bg-danger-light text-danger border-danger",
  hibernated: "bg-bg text-text-muted border-border-light",
  unknown: "bg-bg text-text-muted border-border-light",
};

export function ListView() {
  const templates = useStore(s => s.templates);
  const instances = useStore(s => s.instances);
  const loading = useStore(s => s.loading);
  const fetchTemplates = useStore(s => s.fetchTemplates);
  const fetchInstances = useStore(s => s.fetchInstances);
  const createTemplate = useStore(s => s.createTemplate);
  const deleteTemplate = useStore(s => s.deleteTemplate);
  const createInstance = useStore(s => s.createInstance);
  const deleteInstance = useStore(s => s.deleteInstance);
  const selectInstance = useStore(s => s.selectInstance);
  const setView = useStore(s => s.setView);
  const showConfirm = useStore(s => s.showConfirm);
  const connectSlack = useStore(s => s.connectSlack);
  const disconnectSlack = useStore(s => s.disconnectSlack);
  const slackAvailable = useStore(s => !!s.availableChannels.slack);

  const [showTmplDlg, setShowTmplDlg] = useState(false);
  const [busyTmpl, setBusyTmpl] = useState(false);
  const [showInstDlg, setShowInstDlg] = useState<string | null>(null);
  const [busyInst, setBusyInst] = useState<string | null>(null);
  const [delTmpl, setDelTmpl] = useState<string | null>(null);
  const [showSlackDlg, setShowSlackDlg] = useState<string | null>(null);

  const byTemplate = useMemo(() => {
    const m = new Map<string, InstanceView[]>();
    for (const i of instances) m.set(i.templateName, [...(m.get(i.templateName) ?? []), i]);
    return m;
  }, [instances]);

  return (
    <>
      <div>
        {/* Page header */}
        <div className="flex items-center mb-8">
          <h1 className="text-[24px] font-bold text-text">Agent Templates</h1>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => { fetchTemplates(); fetchInstances(); }}
              className="btn-brutal h-9 w-9 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent"
              style={{ boxShadow: "var(--shadow-brutal-sm)" }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => setShowTmplDlg(true)}
              disabled={busyTmpl}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-semibold text-white disabled:opacity-40 flex items-center gap-1.5"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            >
              <Plus size={14} /> New Template
            </button>
          </div>
        </div>

        {/* Empty state (only when not loading) */}
        {!loading.templates && !loading.instances && templates.length === 0 && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-8 py-16 text-center">
            <p className="text-[15px] text-text-secondary mb-4">No templates yet</p>
            <button
              onClick={() => setShowTmplDlg(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-semibold text-white flex items-center gap-1.5 mx-auto"
              style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            >
              <Plus size={14} /> Create your first template
            </button>
          </div>
        )}

        {/* Template cards */}
        <div className="flex flex-col gap-6">
          {templates.map(tmpl => {
            const insts = byTemplate.get(tmpl.name) ?? [];
            return (
              <div
                key={tmpl.name}
                className="rounded-xl border-2 border-border bg-surface overflow-hidden anim-in transition-shadow hover:shadow-[4px_4px_0_#292524]"
                style={{ boxShadow: "var(--shadow-brutal)" }}
              >
                {/* Card header */}
                <div className="px-6 pt-5 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-[17px] font-bold text-text">{tmpl.name}</h2>
                        <span className="text-[12px] font-semibold text-text-muted border-2 border-border-light rounded-full px-2.5 py-0.5">
                          {insts.length} instance{insts.length !== 1 && "s"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-info bg-info-light text-info rounded-full px-2.5 py-0.5">
                          {tmpl.image}
                        </span>
                        {tmpl.description && (
                          <span className="text-[13px] text-text-secondary">{tmpl.description}</span>
                        )}
                        {tmpl.mcpServers && Object.keys(tmpl.mcpServers).length > 0 && (
                          <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-[0.03em] border-2 border-accent bg-accent-light text-accent rounded-full px-2.5 py-0.5">
                            {Object.keys(tmpl.mcpServers).length} MCP
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setShowInstDlg(tmpl.name)}
                        disabled={busyInst === tmpl.name}
                        className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3.5 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent disabled:opacity-40 flex items-center gap-1"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                      >
                        <Plus size={12} /> Instance
                      </button>
                      <button
                        onClick={async () => { if (!await showConfirm(`Delete template "${tmpl.name}"?`, "Delete Template")) return; setDelTmpl(tmpl.name); await deleteTemplate(tmpl.name); setDelTmpl(null); }}
                        disabled={delTmpl === tmpl.name}
                        className="btn-brutal h-8 w-8 rounded-lg border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger disabled:opacity-40"
                        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                        title="Delete template"
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
                    const ready = inst.status?.podReady === true;
                    const state = statusState(inst);
                    const label = statusLabel(inst);
                    const colors = badgeColors[state] || badgeColors.unknown;
                    return (
                      <div
                        key={inst.name}
                        onClick={ready ? () => selectInstance(inst.name) : undefined}
                        className={`flex items-center gap-4 border-t-2 border-border-light px-6 py-3.5 transition-colors ${ready ? "cursor-pointer hover:bg-accent-light" : "opacity-50"}`}
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
                            if (inst.connectedChannels.includes("slack")) {
                              if (await showConfirm(`Disconnect Slack from "${inst.name}"?`, "Disconnect Slack")) disconnectSlack(inst.name);
                            } else {
                              setShowSlackDlg(inst.name);
                            }
                          }}
                          className={`h-7 w-7 rounded-md border-2 flex items-center justify-center transition-colors ${inst.connectedChannels.includes("slack") ? "border-accent text-accent hover:text-danger hover:border-danger" : "border-border-light text-text-muted hover:text-accent hover:border-accent"}`}
                          title={inst.connectedChannels.includes("slack") ? "Disconnect Slack" : "Connect Slack"}
                        >
                          {inst.connectedChannels.includes("slack") ? <MessageSquareOff size={12} /> : <MessageSquare size={12} />}
                        </button>
                        )}
                        <button
                          onClick={async e => { e.stopPropagation(); if (await showConfirm(`Delete instance "${inst.name}"?`, "Delete Instance")) deleteInstance(inst.name); }}
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

      {showTmplDlg && (
        <CreateTemplateDialog
          onSubmit={async (input) => { setShowTmplDlg(false); setBusyTmpl(true); await createTemplate(input); setBusyTmpl(false); }}
          onCancel={() => setShowTmplDlg(false)}
          onGoToConnectors={() => { setShowTmplDlg(false); setView("connectors"); }}
        />
      )}
      {showInstDlg && (
        <CreateInstanceDialog
          templateName={showInstDlg}
          mcpServers={templates.find(t => t.name === showInstDlg)?.mcpServers}
          onSubmit={async (name, mcp) => { const t = showInstDlg; setShowInstDlg(null); setBusyInst(t); await createInstance(t, name, mcp); setBusyInst(null); }}
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
