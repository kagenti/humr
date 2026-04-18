import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { OPENAI_HOST_PATTERN, isOpenAiSecret } from "../types.js";
import { AuthModeBadge } from "../components/auth-mode-badge.js";
import {
  Sparkles,
  RefreshCw,
  X,
  Copy,
  Check,
} from "lucide-react";

export function ProvidersView() {
  const secrets = useStore((s) => s.secrets);
  const fetchSecrets = useStore((s) => s.fetchSecrets);
  const createSecret = useStore((s) => s.createSecret);
  const deleteSecret = useStore((s) => s.deleteSecret);
  const showConfirm = useStore((s) => s.showConfirm);

  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  // Anthropic form
  const [anthropicKey, setAnthropicKey] = useState("");
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  const [openAiKey, setOpenAiKey] = useState("");
  const [savingOpenAi, setSavingOpenAi] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!loaded.current) setLoading(true);
    await fetchSecrets();
    loaded.current = true;
    setLoading(false);
  }, [fetchSecrets]);

  useEffect(() => {
    load();
  }, [load]);

  const anthropic = secrets.find((s) => s.type === "anthropic");
  const openAi = secrets.find(isOpenAiSecret);

  const saveAnthropic = async () => {
    if (!anthropicKey.trim()) return;
    setSavingAnthropic(true);
    try {
      await createSecret({
        type: "anthropic",
        name: "Anthropic API Key",
        value: anthropicKey.trim(),
      });
      setAnthropicKey("");
    } finally {
      setSavingAnthropic(false);
    }
  };

  const removeAnthropic = async () => {
    if (!anthropic) return;
    if (!(await showConfirm("Remove Anthropic API key?", "Remove Key"))) return;
    await deleteSecret(anthropic.id);
  };

  const saveOpenAi = async () => {
    if (!openAiKey.trim()) return;
    setSavingOpenAi(true);
    try {
      await createSecret({
        type: "generic",
        name: "OpenAI API Key",
        value: openAiKey.trim(),
        hostPattern: OPENAI_HOST_PATTERN,
      });
      setOpenAiKey("");
    } finally {
      setSavingOpenAi(false);
    }
  };

  const removeOpenAi = async () => {
    if (!openAi) return;
    if (!(await showConfirm("Remove OpenAI API key?", "Remove Key"))) return;
    await deleteSecret(openAi.id);
  };

  const copySetupToken = () => {
    navigator.clipboard.writeText("claude setup-token");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inp =
    "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[24px] font-bold text-text">Providers</h1>
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
        Provider credentials for the AI harnesses that power your agents.
      </p>

      {/* Anthropic */}
      <section className="mb-8">
        {!loaded.current ? (
          <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 h-[72px] anim-pulse" />
        ) : anthropic ? (
          <div
            className="rounded-xl border-2 border-accent bg-accent-light p-5 anim-in"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-accent flex items-center justify-center text-white">
                <Sparkles size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[15px] font-bold text-text">Anthropic</span>
                  <AuthModeBadge mode={anthropic.authMode} />
                </div>
                <div className="text-[12px] text-text-muted">
                  Connected — available to agents that use Anthropic
                </div>
              </div>
              <button
                onClick={removeAnthropic}
                className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                title="Remove"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl border-2 border-warning bg-warning-light p-5 anim-in flex flex-col gap-4"
            style={{ boxShadow: "var(--shadow-brutal)" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-warning flex items-center justify-center text-white">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="text-[15px] font-bold text-text">Anthropic</div>
                <div className="text-[12px] text-text-muted">
                  Use this with agents that talk to Anthropic. Paste an API key (
                  <span className="font-mono">sk-ant-api…</span>) or an OAuth
                  token (<span className="font-mono">sk-ant-oat…</span>) — the
                  type is detected automatically.
                </div>
              </div>
            </div>

            {/* setup-token helper */}
            <div className="rounded-lg border-2 border-border-light bg-bg px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-1">
                  Quick setup
                </div>
                <div className="text-[13px] text-text-secondary">
                  If you use Claude Code locally, run this to generate a token:
                </div>
                <code className="text-[13px] font-mono font-semibold text-accent mt-1 block">
                  claude setup-token
                </code>
              </div>
              <button
                onClick={copySetupToken}
                className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center gap-1.5 shrink-0"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                title="Copy command"
              >
                {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="flex gap-3">
              <input
                className={inp}
                type="password"
                placeholder="sk-ant-api… or sk-ant-oat…"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveAnthropic()}
              />
              <button
                className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40 shrink-0"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={saveAnthropic}
                disabled={!anthropicKey.trim() || savingAnthropic}
              >
                {savingAnthropic ? "..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* OpenAI */}
      <section className="mb-8">
        {!loaded.current ? (
          <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 h-[72px] anim-pulse" />
        ) : openAi ? (
          <div
            className="rounded-xl border-2 border-accent bg-accent-light p-5 anim-in"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-accent flex items-center justify-center text-white">
                <Sparkles size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[15px] font-bold text-text">OpenAI</span>
                </div>
                <div className="text-[12px] text-text-muted">
                  Connected — available to agents that use OpenAI
                </div>
              </div>
              <button
                onClick={removeOpenAi}
                className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger"
                style={{ boxShadow: "var(--shadow-brutal-sm)" }}
                title="Remove"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl border-2 border-warning bg-warning-light p-5 anim-in flex flex-col gap-4"
            style={{ boxShadow: "var(--shadow-brutal)" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-warning flex items-center justify-center text-white">
                <Sparkles size={18} />
              </div>
              <div>
                <div className="text-[15px] font-bold text-text">OpenAI</div>
                <div className="text-[12px] text-text-muted">
                  Use this with agents that talk to OpenAI. The key is injected for{" "}
                  <span className="font-mono">{OPENAI_HOST_PATTERN}</span>.
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <input
                className={inp}
                type="password"
                placeholder="sk-proj-…"
                value={openAiKey}
                onChange={(e) => setOpenAiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveOpenAi()}
              />
              <button
                className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40 shrink-0"
                style={{ boxShadow: "var(--shadow-brutal-accent)" }}
                onClick={saveOpenAi}
                disabled={!openAiKey.trim() || savingOpenAi}
              >
                {savingOpenAi ? "..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Coming Soon providers */}
      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">
          Coming Soon
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ComingSoonCard name="Google" description="Powers Gemini CLI agents" />
        </div>
      </section>
    </div>
  );
}

function ComingSoonCard({ name, description }: { name: string; description: string }) {
  return (
    <div
      className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 opacity-60"
      style={{ boxShadow: "var(--shadow-brutal-sm)" }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-muted">
          <Sparkles size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[14px] font-semibold text-text">{name}</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.03em] border-2 border-border-light bg-surface-raised text-text-muted rounded-full px-2 py-0.5">
              Coming Soon
            </span>
          </div>
          <div className="text-[12px] text-text-muted">{description}</div>
        </div>
      </div>
    </div>
  );
}
