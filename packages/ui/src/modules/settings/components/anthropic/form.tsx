import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTestAnthropic } from "../../../secrets/api/mutations.js";
import { CardIcon } from "./card-icon.js";
import { IconButton } from "./icon-button.js";
import { mismatchError, type Mode, MODES, stripWhitespace } from "./modes.js";

export function AnthropicForm({
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
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; message: string } | null
  >(null);
  const testTokenRef = useRef(0);
  const testAnthropic = useTestAnthropic();
  const testing = testAnthropic.isPending;

  const error = mismatchError(value, mode);
  const sanitized = stripWhitespace(value);
  const canSave = sanitized.length > 0 && !error && !saving && !testing;

  useEffect(() => {
    testTokenRef.current++;
    setTestResult(null);
  }, [value, mode]);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ mode, value: sanitized });
      setValue("");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!canSave) return;
    const token = ++testTokenRef.current;
    setTestResult(null);
    try {
      const result = await testAnthropic.mutateAsync({
        value: sanitized,
        envName: mode === "api-key" ? "ANTHROPIC_API_KEY" : "CLAUDE_CODE_OAUTH_TOKEN",
      });
      if (token !== testTokenRef.current) return;
      setTestResult(result.ok ? { ok: true } : { ok: false, message: result.message });
    } catch {
      if (token !== testTokenRef.current) return;
      setTestResult({ ok: false, message: "Could not verify credential." });
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

      {mode === "oauth" && <QuickSetupHint />}

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
      on your own machine (with Claude Code installed) to generate a token.
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
