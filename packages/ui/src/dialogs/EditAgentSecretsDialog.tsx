import { useState, useEffect } from "react";
import type { SecretView, SecretMode } from "api-server-api";
import { platform } from "../platform.js";
import { AuthModeBadge } from "../views/ConnectorsView.js";
import { Lock, Sparkles, Globe, Search } from "lucide-react";

export function EditAgentSecretsDialog({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [mode, setMode] = useState<SecretMode>("selective");
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [secs, access] = await Promise.all([
          platform.secrets.list.query(),
          platform.secrets.getAgentAccess.query({ agentName: agentId }),
        ]);
        if (cancelled) return;
        setSecrets(secs);
        setMode(access.mode);
        setAssigned(new Set(access.secretIds));
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const toggle = (id: string) =>
    setAssigned((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const selectAll = () => setAssigned(new Set(filtered.map((s) => s.id)));
  const clearAll = () => setAssigned(new Set());

  const save = async () => {
    setSaving(true);
    try {
      await platform.secrets.setAgentAccess.mutate({
        agentName: agentId,
        mode,
        secretIds: [...assigned],
      });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
      setSaving(false);
    }
  };

  // Classify each secret — renders consistently with the Connectors page
  const classify = (s: SecretView): "anthropic" | "mcp" | "secret" => {
    if (s.type === "anthropic") return "anthropic";
    if (s.name.startsWith("__humr_mcp:")) return "mcp";
    return "secret";
  };

  const displayName = (s: SecretView): string => {
    if (s.name.startsWith("__humr_mcp:")) return s.name.slice("__humr_mcp:".length);
    return s.name;
  };

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? secrets.filter((s) =>
        displayName(s).toLowerCase().includes(q) ||
        s.hostPattern.toLowerCase().includes(q),
      )
    : secrets;

  const counts = { total: filtered.length, selected: filtered.filter((s) => assigned.has(s.id)).length };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-h-[85vh] overflow-y-auto rounded-xl border-2 border-border bg-surface p-7 flex flex-col gap-5 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-[20px] font-bold text-text">Credential Access</h2>
          <p className="text-[12px] text-text-muted mt-1">
            Credentials are injected by the OneCLI gateway at request time —{" "}
            <span className="font-semibold text-text-secondary">{agentName}</span>{" "}
            never sees raw values.
          </p>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-2 gap-3">
          <ModeCard
            active={mode === "all"}
            icon={<Globe size={16} />}
            title="All credentials"
            description="Every secret and app connection"
            onClick={() => setMode("all")}
          />
          <ModeCard
            active={mode === "selective"}
            icon={<Lock size={16} />}
            title="Selective"
            description="Choose specific credentials"
            onClick={() => setMode("selective")}
          />
        </div>

        {error && (
          <div className="rounded-lg border-2 border-danger bg-danger-light px-4 py-2 text-[12px] text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-2">
            <div className="h-8 rounded-lg bg-surface-raised anim-pulse" />
            <div className="h-14 rounded-lg bg-surface-raised anim-pulse" />
            <div className="h-14 rounded-lg bg-surface-raised anim-pulse" />
          </div>
        ) : mode === "all" ? (
          <div className="rounded-lg border-2 border-border-light bg-surface-raised px-5 py-6 text-center">
            <p className="text-[13px] text-text-secondary">
              Agent has access to <strong>all {secrets.length} credentials</strong>.
            </p>
            <p className="text-[11px] text-text-muted mt-1">
              Switch to <em>Selective</em> to restrict which credentials the agent can use.
            </p>
          </div>
        ) : (
          <>
            {/* Filter + select-all */}
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  className="w-full h-9 rounded-lg border-2 border-border-light bg-bg pl-9 pr-4 text-[13px] text-text outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
                  placeholder="Filter credentials..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center text-[11px] text-text-muted">
              <span>
                <strong className="text-text">{counts.selected}</strong> of {counts.total} selected
              </span>
              <span className="ml-auto flex gap-3">
                <button className="hover:text-accent font-semibold" onClick={selectAll}>
                  Select all
                </button>
                <span>·</span>
                <button className="hover:text-accent font-semibold" onClick={clearAll}>
                  Clear
                </button>
              </span>
            </div>

            {/* Secrets list */}
            {filtered.length === 0 && (
              <span className="text-[12px] text-text-muted text-center py-4">
                {q ? "No matching credentials" : "No credentials yet — add some on the Connectors page"}
              </span>
            )}
            <div className="flex flex-col gap-2">
              {filtered.map((s) => {
                const kind = classify(s);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-2.5 cursor-pointer transition-colors hover:border-accent ${assigned.has(s.id) ? "border-accent bg-accent-light" : "border-border-light"}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)] w-4 h-4"
                      checked={assigned.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    {kind === "anthropic" && <Sparkles size={14} className="text-warning shrink-0" />}
                    {kind === "mcp" && <Globe size={14} className="text-info shrink-0" />}
                    {kind === "secret" && <Lock size={14} className="text-text-secondary shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text truncate">{displayName(s)}</div>
                      <div className="text-[11px] font-mono text-text-muted truncate">{s.hostPattern}</div>
                    </div>
                    {kind === "anthropic" ? (
                      <AuthModeBadge mode={s.authMode} />
                    ) : (
                      <span
                        className={`text-[10px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2 py-0.5 shrink-0 ${
                          kind === "mcp"
                            ? "bg-info-light text-info border-info"
                            : "bg-surface-raised text-text-muted border-border-light"
                        }`}
                      >
                        {kind === "mcp" ? "MCP" : "Secret"}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 pt-1">
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
            disabled={saving || loading}
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border-2 p-3.5 text-left flex flex-col gap-1.5 transition-colors ${
        active
          ? "border-accent bg-accent-light"
          : "border-border-light bg-bg hover:border-border"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`w-7 h-7 rounded-md border-2 flex items-center justify-center ${
            active
              ? "bg-accent text-white border-accent-hover"
              : "bg-surface border-border-light text-text-secondary"
          }`}
        >
          {icon}
        </div>
      </div>
      <div>
        <div className="text-[13px] font-bold text-text">{title}</div>
        <div className="text-[11px] text-text-muted">{description}</div>
      </div>
    </button>
  );
}
