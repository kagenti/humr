import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { getAuthConfig } from "../auth.js";
import {
  RefreshCw,
  Lock,
  KeyRound,
  Plus,
  ExternalLink,
  X,
} from "lucide-react";

export function ConnectionsView() {
  const secrets = useStore((s) => s.secrets);
  const fetchSecrets = useStore((s) => s.fetchSecrets);
  const createSecret = useStore((s) => s.createSecret);
  const deleteSecret = useStore((s) => s.deleteSecret);
  const showConfirm = useStore((s) => s.showConfirm);

  const [loading, setLoading] = useState(true);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const loaded = useRef(false);

  // Secret form
  const [secretForm, setSecretForm] = useState({
    name: "",
    value: "",
    hostPattern: "",
  });
  const [savingSecret, setSavingSecret] = useState(false);

  const onecliUrl = getAuthConfig()?.onecliUrl;

  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    await fetchSecrets();
    loaded.current = true;
    setLoading(false);
  }, [fetchSecrets]);

  useEffect(() => {
    load();
  }, [load]);

  const customSecrets = secrets.filter(
    (s) => s.type !== "anthropic" && !s.name.startsWith("__humr_mcp:"),
  );

  const saveSecret = async () => {
    if (
      !secretForm.name.trim() ||
      !secretForm.value.trim() ||
      !secretForm.hostPattern.trim()
    )
      return;
    setSavingSecret(true);
    try {
      await createSecret({
        type: "generic",
        name: secretForm.name.trim(),
        value: secretForm.value.trim(),
        hostPattern: secretForm.hostPattern.trim(),
      });
      setSecretForm({ name: "", value: "", hostPattern: "" });
      setShowAddSecret(false);
    } finally {
      setSavingSecret(false);
    }
  };

  const removeSecret = async (id: string, name: string) => {
    if (!(await showConfirm(`Delete "${name}"?`, "Delete Secret"))) return;
    await deleteSecret(id);
  };

  const inp =
    "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] font-bold text-text">Connections</h1>
        <button
          onClick={load}
          className="ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal"
          style={{ boxShadow: "var(--shadow-brutal-sm)" }}
        >
          <span className={loading ? "anim-spin" : ""}>
            <RefreshCw size={13} />
          </span>
        </button>
      </div>

      <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">
        Credentials that OneCLI injects into your agents' outbound HTTP requests.
      </p>

      {/* Apps */}
      {onecliUrl && (
        <section className="mb-8">
          <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">
            Apps
          </h2>
          <a
            href={`${onecliUrl}/connections`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] hover:border-accent"
            style={{ boxShadow: "var(--shadow-brutal)" }}
          >
            <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
              <KeyRound size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-text">
                GitHub, Google, Slack
              </div>
              <div className="text-[12px] text-text-muted">
                OAuth apps managed in OneCLI
              </div>
            </div>
            <ExternalLink size={14} className="text-text-muted shrink-0" />
          </a>
        </section>
      )}

      {/* Secrets */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
            Secrets
          </h2>
        </div>

        {!loaded.current && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
            <div className="rounded-xl border-2 border-border-light bg-surface h-[68px] anim-pulse" />
          </div>
        )}

        {loaded.current && customSecrets.length === 0 && !showAddSecret && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-10 text-center text-[14px] text-text-muted anim-in">
            No custom secrets yet
          </div>
        )}

        {loaded.current && (
          <div className="flex flex-col gap-3">
            {customSecrets.map((s, i) => (
              <div
                key={s.id}
                className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] anim-in"
                style={{
                  boxShadow: "var(--shadow-brutal)",
                  animationDelay: `${i * 50}ms`,
                }}
              >
                <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
                  <Lock size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-text truncate">
                    {s.name}
                  </div>
                  <div className="text-[12px] font-mono text-text-muted truncate">
                    {s.hostPattern}
                  </div>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 bg-surface-raised text-text-muted border-border-light">
                  Secret
                </span>
                <button
                  onClick={() => removeSecret(s.id, s.name)}
                  className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger"
                  style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                  title="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add secret — inline button / form (like MCP tab) */}
        {loaded.current && (
          <div className="mt-4 anim-in">
            {!showAddSecret ? (
              <button
                onClick={() => setShowAddSecret(true)}
                className="btn-brutal rounded-xl border-2 border-border bg-surface p-4 text-left flex items-center gap-3 hover:border-accent hover:bg-accent-light transition-colors w-full"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
              >
                <div className="w-8 h-8 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
                  <Lock size={16} />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-bold text-text">Add Secret</div>
                  <div className="text-[11px] text-text-muted">Bearer token for a custom host</div>
                </div>
                <Plus size={14} className="text-text-muted" />
              </button>
            ) : (
              <div
                className="rounded-xl border-2 border-border bg-surface p-6 flex flex-col gap-4 anim-scale-in"
                style={{ boxShadow: "var(--shadow-brutal)" }}
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-[14px] font-bold text-text">Add Secret</h3>
                  <button
                    className="ml-auto text-text-muted hover:text-text"
                    onClick={() => setShowAddSecret(false)}
                    title="Cancel"
                  >
                    <X size={16} />
                  </button>
                </div>

                <p className="text-[13px] text-text-secondary leading-relaxed">
                  Injects a bearer token into outgoing HTTP requests whose host
                  matches the pattern below.
                </p>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                    Name
                  </label>
                  <input
                    className={inp}
                    placeholder="e.g. Linear Token"
                    value={secretForm.name}
                    onChange={(e) =>
                      setSecretForm((p) => ({ ...p, name: e.target.value }))
                    }
                    autoFocus
                  />
                  <p className="text-[11px] text-text-muted">
                    A label so you can identify this secret later.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                    Token
                  </label>
                  <input
                    className={inp}
                    type="password"
                    placeholder="The secret value to inject"
                    value={secretForm.value}
                    onChange={(e) =>
                      setSecretForm((p) => ({ ...p, value: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-text-muted">
                    Injected as{" "}
                    <span className="font-mono">
                      Authorization: Bearer &lt;value&gt;
                    </span>
                    . Stored encrypted in OneCLI — the agent never sees the raw
                    value.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
                    Host Pattern
                  </label>
                  <input
                    className={`${inp} font-mono`}
                    placeholder="e.g. api.linear.app"
                    value={secretForm.hostPattern}
                    onChange={(e) =>
                      setSecretForm((p) => ({
                        ...p,
                        hostPattern: e.target.value,
                      }))
                    }
                  />
                  <p className="text-[11px] text-text-muted">
                    Hostname the token applies to. Requests to other hosts are
                    untouched. Supports wildcards (e.g.{" "}
                    <span className="font-mono">*.example.com</span>).
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40"
                    style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                    onClick={saveSecret}
                    disabled={
                      savingSecret ||
                      !secretForm.name.trim() ||
                      !secretForm.value.trim() ||
                      !secretForm.hostPattern.trim()
                    }
                  >
                    {savingSecret ? "..." : "Add Secret"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
