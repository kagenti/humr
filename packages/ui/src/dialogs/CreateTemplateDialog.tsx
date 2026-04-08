import { useState, useEffect } from "react";
import type { MCPServerConfig } from "../types.js";
import { StatusIndicator } from "../components/StatusIndicator.js";

export function CreateTemplateDialog({ onSubmit, onCancel, onGoToConnectors }: {
  onSubmit: (i: { name: string; image: string; description?: string; mcpServers?: Record<string, MCPServerConfig> }) => void;
  onCancel: () => void;
  onGoToConnectors: () => void;
}) {
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [desc, setDesc] = useState("");
  const [conns, setConns] = useState<{ hostname: string; connectedAt: string; expired: boolean }[]>([]);
  const [selConns, setSelConns] = useState<Set<string>>(new Set());
  const [loadConns, setLoadConns] = useState(true);
  useEffect(() => { fetch("/api/mcp/connections").then(r => r.json()).then(d => { if (Array.isArray(d)) setConns(d); }).catch(() => {}).finally(() => setLoadConns(false)); }, []);

  const toggleConn = (h: string) => setSelConns(p => { const n = new Set(p); n.has(h) ? n.delete(h) : n.add(h); return n; });

  const submit = () => {
    const n = name.trim(), img = image.trim(); if (!n || !img) return;
    const srv: Record<string, MCPServerConfig> = {};
    for (const h of selConns) srv[h.split(".")[0]] = { type: "http", url: `https://${h}/mcp` };
    onSubmit({ name: n, image: img, description: desc.trim() || undefined, mcpServers: Object.keys(srv).length ? srv : undefined });
  };

  const inp = "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in" onClick={onCancel}>
      <div
        className="w-[520px] max-h-[85vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-7 flex flex-col gap-5 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-[20px] font-bold text-text">New Template</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Name</span>
          <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="my-template" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Image</span>
          <input className={inp} value={image} onChange={e => setImage(e.target.value)} placeholder="humr-base:latest" />
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
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text"
            style={{ boxShadow: "var(--shadow-brutal-sm)" }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            onClick={submit}
            disabled={!name.trim() || !image.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
