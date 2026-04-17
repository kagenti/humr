import { useState } from "react";

export function CreateInstanceDialog({ agentName, onSubmit, onCancel }: {
  agentName: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");

  const submit = () => { const t = name.trim(); if (!t) return; onSubmit(t); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in" onClick={onCancel}>
      <div
        className="w-[460px] max-h-[80vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-7 flex flex-col gap-5 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h2 className="text-[20px] font-bold text-text">New Instance</h2>
          <p className="text-[12px] text-text-muted mt-1">Agent: <span className="font-semibold text-text-secondary">{agentName}</span></p>
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
