import { useState, useEffect } from "react";
import type { TemplateView, SecretView, SecretMode } from "../types.js";
import { isMcpSecret, mcpHostnameFromSecretName } from "../types.js";
import { Globe, Lock, Sparkles } from "lucide-react";
import { platform } from "../platform.js";
import { AuthModeBadge } from "../components/auth-mode-badge.js";

type Step = "pick" | "configure";

export function AddAgentDialog({ templates, onSubmit, onCancel, onGoToProviders }: {
  templates: TemplateView[];
  onSubmit: (i: { name: string; templateId?: string; image?: string; description?: string; secretMode?: SecretMode; secretIds?: string[]; autoCreateInstance?: boolean }) => void;
  onCancel: () => void;
  onGoToProviders: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateView | null>(null);
  const [customImage, setCustomImage] = useState("");

  // Configure step state
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [selSecrets, setSelSecrets] = useState<Set<string>>(new Set());
  const [loadSecrets, setLoadSecrets] = useState(true);
  const [secretMode, setSecretMode] = useState<SecretMode>("selective");
  const [autoCreateInstance, setAutoCreateInstance] = useState(true);

  useEffect(() => {
    platform.secrets.list.query().then(setSecrets).catch(() => {}).finally(() => setLoadSecrets(false));
  }, []);

  const toggleSecret = (id: string) => setSelSecrets(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
    setName("");
    setDesc("");
    setStep("configure");
  };

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onSubmit({
      name: n,
      templateId: selectedTemplate?.id,
      image: selectedTemplate ? undefined : customImage.trim(),
      description: desc.trim() || undefined,
      secretMode,
      secretIds: secretMode === "selective" && selSecrets.size ? [...selSecrets] : undefined,
      autoCreateInstance,
    });
  };

  const inp = "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  const anthropicSecrets = secrets.filter(s => s.type === "anthropic");
  const mcpSecrets = secrets.filter(s => isMcpSecret(s));
  const genericSecrets = secrets.filter(s => s.type !== "anthropic" && !isMcpSecret(s));

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

            {!loadSecrets && anthropicSecrets.length === 0 && (
              <div className="rounded-lg border-2 border-warning bg-warning-light px-4 py-3 flex items-center gap-3">
                <Sparkles size={16} className="text-warning shrink-0" />
                <p className="text-[12px] text-text-secondary">
                  No provider configured — this agent won't be able to reach an AI model.{" "}
                  <button className="text-accent font-semibold hover:underline" onClick={onGoToProviders}>Set one up</button>
                </p>
              </div>
            )}

            {/* Connections */}
            <div className="flex flex-col gap-3">
              <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">Connections</span>

              {/* Mode toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSecretMode("selective")}
                  className={`rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${secretMode === "selective" ? "border-accent bg-accent-light" : "border-border-light bg-bg hover:border-border"}`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Lock size={12} className="text-text-secondary" />
                    <span className="text-[12px] font-bold text-text">Selective</span>
                  </div>
                  <span className="text-[11px] text-text-muted">Only connections you pick</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSecretMode("all")}
                  className={`rounded-lg border-2 px-3 py-2.5 text-left transition-colors ${secretMode === "all" ? "border-accent bg-accent-light" : "border-border-light bg-bg hover:border-border"}`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Globe size={12} className="text-text-secondary" />
                    <span className="text-[12px] font-bold text-text">All</span>
                  </div>
                  <span className="text-[11px] text-text-muted">Any connection, now or later</span>
                </button>
              </div>

              <p className="text-[12px] text-text-muted leading-relaxed">
                {secretMode === "selective"
                  ? "Only the connections you pick below are available to this agent."
                  : "This agent can use any connection, including ones you add later."}
              </p>

              {loadSecrets && <span className="text-[12px] text-text-muted">Loading...</span>}
              {!loadSecrets && secrets.length === 0 && (
                <span className="text-[12px] text-text-muted">
                  No connections yet — <button className="text-accent font-semibold hover:underline" onClick={onGoToProviders}>add one</button>
                </span>
              )}

              {/* Selective list — only rendered in selective mode */}
              {secretMode === "selective" && (
                <div className="flex flex-col gap-4">
                  {/* Provider */}
                  {anthropicSecrets.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">Provider</div>
                      <div className="flex flex-col gap-2">
                        {anthropicSecrets.map(s => (
                          <label
                            key={s.id}
                            className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${selSecrets.has(s.id) ? "border-accent bg-accent-light" : "border-border-light"}`}
                          >
                            <input type="checkbox" className="accent-[var(--color-accent)] w-4 h-4" checked={selSecrets.has(s.id)} onChange={() => toggleSecret(s.id)} />
                            <Sparkles size={14} className="text-warning" />
                            <span className="text-[13px] font-medium text-text flex-1">{s.name}</span>
                            <AuthModeBadge mode={s.authMode} />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* MCP Servers */}
                  {mcpSecrets.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">MCP Servers</div>
                      <div className="flex flex-col gap-2">
                        {mcpSecrets.map(s => (
                          <label
                            key={s.id}
                            className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${selSecrets.has(s.id) ? "border-accent bg-accent-light" : "border-border-light"}`}
                          >
                            <input type="checkbox" className="accent-[var(--color-accent)] w-4 h-4" checked={selSecrets.has(s.id)} onChange={() => toggleSecret(s.id)} />
                            <Globe size={14} className="text-info" />
                            <span className="text-[13px] font-medium text-text">{mcpHostnameFromSecretName(s.name)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Secrets */}
                  {genericSecrets.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">Secrets</div>
                      <div className="flex flex-col gap-2">
                        {genericSecrets.map(s => (
                          <label
                            key={s.id}
                            className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${selSecrets.has(s.id) ? "border-accent bg-accent-light" : "border-border-light"}`}
                          >
                            <input type="checkbox" className="accent-[var(--color-accent)] w-4 h-4" checked={selSecrets.has(s.id)} onChange={() => toggleSecret(s.id)} />
                            <Lock size={14} className="text-text-secondary" />
                            <span className="text-[13px] font-medium text-text">{s.name}</span>
                            <span className="ml-auto text-[11px] font-mono text-text-muted">{s.hostPattern}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none mr-auto" title="Start a running instance of this agent right away">
                <input
                  type="checkbox"
                  className="accent-[var(--color-accent)] w-4 h-4"
                  checked={autoCreateInstance}
                  onChange={(e) => setAutoCreateInstance(e.target.checked)}
                />
                <span className="text-[12px] font-semibold text-text-secondary">Create instance immediately</span>
              </label>
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
