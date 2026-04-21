import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../store.js";
import { platform } from "../platform.js";
import {
  ANTHROPIC_OAUTH_ENV_MAPPING,
  ANTHROPIC_API_KEY_ENV_MAPPING,
  type EnvMapping,
  type SecretView,
} from "../types.js";
import { Sparkles, RefreshCw, X, Copy, Check, Pencil } from "lucide-react";

type Mode = "oauth" | "api-key";

const MODES = {
  oauth: {
    label: "OAuth Token",
    placeholder: "sk-ant-oat-…",
    prefix: "sk-ant-oat-",
    mapping: ANTHROPIC_OAUTH_ENV_MAPPING,
  },
  "api-key": {
    label: "API Key",
    placeholder: "sk-ant-api-…",
    prefix: "sk-ant-api-",
    mapping: ANTHROPIC_API_KEY_ENV_MAPPING,
  },
} as const satisfies Record<
  Mode,
  {
    label: string;
    placeholder: string;
    prefix: string;
    mapping: EnvMapping;
  }
>;

function detectMode(envName?: string): Mode {
  return envName === ANTHROPIC_API_KEY_ENV_MAPPING.envName ? "api-key" : "oauth";
}

function mismatchError(value: string, mode: Mode): string | null {
  const v = value.trim();
  if (!v) return null;
  for (const m of Object.keys(MODES) as Mode[]) {
    if (m !== mode && v.startsWith(MODES[m].prefix)) {
      return `This looks like ${MODES[m].label.toLowerCase()} — switch tabs.`;
    }
  }
  return null;
}

export function ProvidersView() {
  const secrets = useStore((s) => s.secrets);
  const agents = useStore((s) => s.agents);
  const fetchSecrets = useStore((s) => s.fetchSecrets);
  const createSecret = useStore((s) => s.createSecret);
  const updateSecret = useStore((s) => s.updateSecret);
  const deleteSecret = useStore((s) => s.deleteSecret);
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);

  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

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

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-text">Providers</h1>
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
        API keys for the AI harnesses that power your agents.
      </p>

      <section className="mb-8">
        {!loaded.current ? (
          <div className="rounded-xl border-2 border-border-light bg-surface px-5 py-4 h-[72px] anim-pulse" />
        ) : anthropic ? (
          <AnthropicConnected
            secret={anthropic}
            onRemove={async () => {
              if (!(await showConfirm("Remove Anthropic API key?", "Remove Key"))) return;
              await deleteSecret(anthropic.id);
            }}
            onSave={async ({ mode, value }) => {
              await updateSecret(anthropic.id, {
                value,
                envMappings: [MODES[mode].mapping],
              });
            }}
          />
        ) : (
          <AnthropicForm
            variant="wizard"
            initialMode="oauth"
            onSave={async ({ mode, value }) => {
              const isFirst = agents.length === 0;
              await createSecret({
                type: "anthropic",
                name: "Anthropic API Key",
                value,
                envMappings: [MODES[mode].mapping],
              });
              if (isFirst) setView("list");
            }}
          />
        )}
      </section>

      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-4">
          Coming Soon
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ComingSoonCard name="OpenAI" description="Powers Codex agents" />
          <ComingSoonCard name="Google" description="Powers Gemini CLI agents" />
        </div>
      </section>
    </div>
  );
}

function AnthropicConnected({
  secret,
  onRemove,
  onSave,
}: {
  secret: SecretView;
  onRemove: () => Promise<void>;
  onSave: (input: { mode: Mode; value: string }) => Promise<void>;
}) {
  const currentMode = detectMode(secret.envMappings?.[0]?.envName);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <AnthropicForm
        variant="edit"
        initialMode={currentMode}
        onCancel={() => setEditing(false)}
        onSave={async (input) => {
          await onSave(input);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className="rounded-xl border-2 border-accent bg-accent-light p-5 anim-in"
      style={{ boxShadow: "var(--shadow-brutal-accent)" }}
    >
      <div className="flex items-center gap-4">
        <CardIcon variant="accent" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text mb-0.5">Anthropic</div>
          <div className="text-[12px] text-text-muted">
            Set up with {MODES[currentMode].label}
          </div>
        </div>
        <IconButton onClick={() => setEditing(true)} title="Edit" hoverTone="accent">
          <Pencil size={13} />
        </IconButton>
        <IconButton onClick={onRemove} title="Remove" hoverTone="danger">
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
}

function AnthropicForm({
  variant,
  initialMode,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  initialMode: Mode;
  onSave: (input: { mode: Mode; value: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; message: string } | null
  >(null);
  const testTokenRef = useRef(0);

  const error = mismatchError(value, mode);
  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && !error && !saving && !testing;

  useEffect(() => {
    testTokenRef.current++;
    setTestResult(null);
  }, [value, mode]);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ mode, value: trimmed });
      setValue("");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!canSave) return;
    const token = ++testTokenRef.current;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await platform.secrets.testAnthropic.mutate({
        value: trimmed,
        envName: mode === "api-key" ? "ANTHROPIC_API_KEY" : "CLAUDE_CODE_OAUTH_TOKEN",
      });
      if (token !== testTokenRef.current) return;
      setTestResult(result.ok ? { ok: true } : { ok: false, message: result.message });
    } catch {
      if (token !== testTokenRef.current) return;
      setTestResult({ ok: false, message: "Could not verify credential." });
    } finally {
      setTesting(false);
    }
  };

  const isEdit = variant === "edit";

  return (
    <div
      className={`rounded-xl border-2 p-5 anim-in flex flex-col gap-4 ${
        isEdit ? "border-accent bg-accent-light" : "border-warning bg-warning-light"
      }`}
      style={{
        boxShadow: isEdit ? "var(--shadow-brutal-accent)" : "var(--shadow-brutal)",
      }}
    >
      <div className="flex items-center gap-3">
        <CardIcon variant={isEdit ? "accent" : "warning"} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text">Anthropic</div>
          <div className="text-[12px] text-text-muted">
            {isEdit
              ? "Pick mode and paste a new credential to replace the existing one."
              : "Required for Claude Code agents. Pick the mode that matches your credential."}
          </div>
        </div>
        {onCancel && (
          <IconButton onClick={onCancel} title="Cancel" hoverTone="neutral">
            <X size={13} />
          </IconButton>
        )}
      </div>

      <ModeToggle mode={mode} onChange={setMode} />

      {mode === "oauth" && !isEdit && <QuickSetupHint />}

      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder={MODES[mode].placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className="btn-brutal h-10 rounded-lg border-2 border-border bg-surface px-4 text-[13px] font-semibold text-text-secondary hover:text-accent hover:border-accent disabled:opacity-40 shrink-0"
          style={{ boxShadow: "var(--shadow-brutal-sm)" }}
          onClick={test}
          disabled={!canSave}
          title="Verify the credential with Anthropic"
        >
          {testing ? "..." : "Test"}
        </button>
        <button
          type="submit"
          className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40 shrink-0"
          style={{ boxShadow: "var(--shadow-brutal-accent)" }}
          disabled={!canSave}
        >
          {saving ? "..." : isEdit ? "Replace" : "Save"}
        </button>
      </form>

      {error && <div className="text-[12px] font-medium text-danger">{error}</div>}
      {!error && testResult?.ok && (
        <div className="text-[12px] font-medium text-success flex items-center gap-1.5">
          <Check size={13} /> Credential is valid.
        </div>
      )}
      {!error && testResult && !testResult.ok && (
        <div className="text-[12px] font-medium text-danger">{testResult.message}</div>
      )}
    </div>
  );
}

function QuickSetupHint() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText("claude setup-token");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="text-[13px] text-text-secondary">
      Run{" "}
      <span className="inline-flex items-center gap-1.5 align-middle">
        <code className="font-mono font-semibold text-accent">claude setup-token</code>
        <button
          onClick={copy}
          className="h-5 w-5 rounded inline-flex items-center justify-center text-text-muted hover:text-accent"
          title="Copy command"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
      </span>{" "}
      inside a Claude Code agent to generate a token.
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex items-center gap-1 border-b-2 border-border-light">
      {(Object.keys(MODES) as Mode[]).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`h-10 px-4 text-[13px] font-semibold border-b-2 -mb-[2px] transition-colors ${
              active
                ? "text-accent border-accent"
                : "text-text-muted border-transparent hover:text-text"
            }`}
          >
            {MODES[m].label}
          </button>
        );
      })}
    </div>
  );
}

function CardIcon({ variant }: { variant: "accent" | "warning" }) {
  return (
    <div
      className={`w-10 h-10 shrink-0 rounded-lg ${variant === "accent" ? "bg-accent" : "bg-warning"} flex items-center justify-center text-white`}
    >
      <Sparkles size={18} />
    </div>
  );
}

function IconButton({
  onClick,
  title,
  hoverTone,
  children,
}: {
  onClick: () => void | Promise<void>;
  title: string;
  hoverTone: "accent" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  const hover =
    hoverTone === "accent"
      ? "hover:text-accent hover:border-accent"
      : hoverTone === "danger"
        ? "hover:text-danger hover:border-danger"
        : "hover:text-text hover:border-border";
  return (
    <button
      onClick={onClick}
      className={`btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted ${hover}`}
      style={{ boxShadow: "var(--shadow-brutal-sm)" }}
      title={title}
    >
      {children}
    </button>
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
