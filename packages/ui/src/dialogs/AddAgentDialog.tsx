import { useState, useEffect } from "react";
import type { TemplateView, MCPServerConfig } from "../types.js";
import { StatusIndicator } from "../components/StatusIndicator.js";
import { authFetch } from "../auth.js";

type Step = "pick" | "configure";

export function AddAgentDialog({ templates, onSubmit, onCancel, onGoToConnectors }: {
  templates: TemplateView[];
  onSubmit: (i: { name: string; templateId?: string; image?: string; description?: string; mcpServers?: Record<string, MCPServerConfig> }) => void;
  onCancel: () => void;
  onGoToConnectors: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateView | null>(null);
  const [customImage, setCustomImage] = useState("");

  // Configure step state
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [conns, setConns] = useState<{ hostname: string; connectedAt: string; expired: boolean }[]>([]);
  const [selConns, setSelConns] = useState<Set<string>>(new Set());
  const [loadConns, setLoadConns] = useState(true);

  useEffect(() => {
    authFetch("/api/mcp/connections").then(r => r.json()).then(d => { if (Array.isArray(d)) setConns(d); }).catch(() => {}).finally(() => setLoadConns(false));
  }, []);

  const toggleConn = (h: string) => setSelConns(p => { const n = new Set(p); n.has(h) ? n.delete(h) : n.add(h); return n; });

  const pickTemplate = (tmpl: TemplateView) => {
    setSelectedTemplate(tmpl);
    setName(tmpl.name);
    setDesc(tmpl.description ?? "");
    setStep("configure");
  };

  const pickCustom = () => {
    const img = customImage.trim();
    if (!img) return;
    setSelectedTemplate(null);
    setStep("configure");
  };

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const srv: Record<string, MCPServerConfig> = {};
    for (const h of selConns) srv[h.split(".")[0]] = { type: "http", url: `https://${h}/mcp` };
    onSubmit({
      name: n,
      templateId: selectedTemplate?.id,
      image: selectedTemplate ? undefined : customImage.trim(),
      description: desc.trim() || undefined,
      mcpServers: Object.keys(srv).length ? srv : undefined,
    });
  };

  const inp = "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in" onClick={onCancel}>
      <div
        className="w-[520px] max-h-[85vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-7 flex flex-col gap-5 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={e => e.stopPropagation()}
      >
        {step === "pick" ? (
          <>
            <h2 className="text-[20px] font-bold text-text">Add Agent</h2>

            {/* Template catalog */}
            {templates.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">From Template</span>
                {templates.map(tmpl => (
                  <button
                    key={tmpl.id}
                    onClick={() => pickTemplate(tmpl)}
                    className="flex items-center gap-3 rounded-lg border-2 border-border-light bg-bg px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent-light"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-text">{tmpl.name}</div>
                      {tmpl.description && <div className="text-[12px] text-text-muted truncate">{tmpl.description}</div>}
                    </div>
                    <span className="text-[11px] font-bold text-info border-2 border-info bg-info-light rounded-full px-2.5 py-0.5 shrink-0">
                      {tmpl.image}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Custom image */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">Custom Image</span>
              <div className="flex gap-2">
                <input
                  className={inp}
                  value={customImage}
                  onChange={e => setCustomImage(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && pickCustom()}
                  placeholder="ghcr.io/org/agent:latest"
                />
                <button
                  className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-bold text-white disabled:opacity-40 shrink-0"
                  style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                  onClick={pickCustom}
                  disabled={!customImage.trim()}
                >
                  Use
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text" style={{ boxShadow: "var(--shadow-brutal-sm)" }} onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-[20px] font-bold text-text">Configure Agent</h2>
              <p className="text-[12px] text-text-muted mt-1">
                {selectedTemplate ? <>Template: <span className="font-semibold text-text-secondary">{selectedTemplate.name}</span></> : <>Image: <span className="font-semibold text-text-secondary">{customImage}</span></>}
              </p>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Name</span>
              <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="my-agent" autoFocus />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Description</span>
              <input className={inp} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional" />
            </label>

            {/* Connectors */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">Connectors</span>
              {loadConns && <span className="text-[12px] text-text-muted">Loading...</span>}
              {!loadConns && conns.length === 0 && (
                <span className="text-[12px] text-text-muted">
                  None — <button className="text-accent font-semibold hover:underline" onClick={onGoToConnectors}>connect a server</button>
                </span>
              )}
              {conns.map(c => (
                <label
                  key={c.hostname}
                  className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${selConns.has(c.hostname) ? "border-accent bg-accent-light" : "border-border-light"} ${c.expired ? "opacity-50" : ""}`}
                >
                  <input type="checkbox" className="accent-[var(--color-accent)] w-4 h-4" checked={selConns.has(c.hostname)} onChange={() => toggleConn(c.hostname)} disabled={c.expired} />
                  <StatusIndicator state={c.expired ? "error" : "ready"} />
                  <span className="text-[13px] font-medium text-text">{c.hostname}</span>
                  {c.expired && <span className="ml-auto text-[10px] font-bold text-danger border-2 border-danger bg-danger-light rounded-full px-2 py-0.5">Expired</span>}
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text" style={{ boxShadow: "var(--shadow-brutal-sm)" }} onClick={() => setStep("pick")}>
                Back
              </button>
              <button
                className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={submit}
                disabled={!name.trim()}
              >
                Create Agent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
