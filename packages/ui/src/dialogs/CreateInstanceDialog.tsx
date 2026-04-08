import { useState } from "react";
import type { MCPServerConfig } from "../types.js";

export function CreateInstanceDialog({ templateName, mcpServers, onSubmit, onCancel }: {
  templateName: string;
  mcpServers?: Record<string, MCPServerConfig> | null;
  onSubmit: (name: string, enabled?: string[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const names = Object.keys(mcpServers ?? {});
  const [enabled, setEnabled] = useState<Set<string>>(new Set(names));
  const toggle = (s: string) => setEnabled(p => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });

  const submit = () => { const t = name.trim(); if (!t) return; onSubmit(t, names.filter(n => enabled.has(n)).length ? names.filter(n => enabled.has(n)) : undefined); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in" onClick={onCancel}>
      <div
        className="w-[460px] max-h-[80vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-7 flex flex-col gap-5 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h2 className="text-[20px] font-bold text-text">New Instance</h2>
          <p className="text-[12px] text-text-muted mt-1">Template: <span className="font-semibold text-text-secondary">{templateName}</span></p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-text-secondary uppercase tracking-[0.03em]">Name</span>
          <input
            className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="my-agent"
            autoFocus
          />
        </label>

        {names.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">MCP Servers</span>
              <span className="text-[11px] font-mono text-text-muted">{enabled.size}/{names.length}</span>
            </div>
            {names.map(sn => (
              <label
                key={sn}
                className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 cursor-pointer transition-colors hover:border-accent ${enabled.has(sn) ? "border-accent bg-accent-light" : "border-border-light"}`}
              >
                <input type="checkbox" className="accent-[var(--color-accent)] w-4 h-4" checked={enabled.has(sn)} onChange={() => toggle(sn)} />
                <span className="text-[13px] font-semibold text-text">{sn}</span>
                <span className="ml-auto text-[11px] font-mono text-text-muted truncate max-w-[200px]">
                  {mcpServers![sn].type === "http" ? mcpServers![sn].url : `${mcpServers![sn].command} ${(mcpServers![sn].args ?? []).join(" ")}`}
                </span>
              </label>
            ))}
          </div>
        )}

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
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
