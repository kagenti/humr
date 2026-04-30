import type { EgressRuleView } from "api-server-api";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useStore } from "../../../store.js";
import { useAgents } from "../../agents/api/queries.js";
import { useCreateEgressRule, useRevokeEgressRule } from "../api/mutations.js";
import { useEgressRulesForAgent } from "../api/queries.js";

const EMPTY: EgressRuleView[] = [];
const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface AddRuleDraft {
  host: string;
  method: string;
  pathPattern: string;
  verdict: "allow" | "deny";
}

const EMPTY_DRAFT: AddRuleDraft = {
  host: "",
  method: "*",
  pathPattern: "*",
  verdict: "allow",
};

export function AgentEgressView() {
  const agentId = useStore((s) => s.agentId);
  const setView = useStore((s) => s.setView);
  const { data: agents = [] } = useAgents();
  const { data: rules = EMPTY, isLoading } = useEgressRulesForAgent(agentId);
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();
  const [draft, setDraft] = useState<AddRuleDraft>(EMPTY_DRAFT);

  const agent = useMemo(
    () => agents.find((a) => a.id === agentId) ?? null,
    [agents, agentId],
  );

  if (!agentId) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink onClick={() => setView("list")} />
        <p className="text-[12px] text-text-muted">Missing agent id.</p>
      </div>
    );
  }

  const canSave =
    draft.host.trim().length > 0
    && draft.method.trim().length > 0
    && draft.pathPattern.trim().length > 0
    && !createRule.isPending;

  // Path-specific rules need MITM, which means the controller has to
  // re-issue the leaf cert and roll the agent pod. The L4 (host-only) path
  // is a pure DB write — no roll. Warn the user so they own the timing.
  const draftRequiresRestart =
    draft.host.trim().length > 0
    && (draft.method !== "*" || draft.pathPattern.trim() !== "*")
    && !rules.some(
      (r) => r.host === draft.host.trim() && (r.method !== "*" || r.pathPattern !== "*"),
    );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (
      draftRequiresRestart
      && !window.confirm(
        `Saving this rule will restart the agent (~5–15s) so Envoy can MITM "${draft.host.trim()}" for path-level enforcement. Continue?`,
      )
    ) return;
    createRule.mutate(
      {
        agentId,
        host: draft.host.trim(),
        method: draft.method.trim().toUpperCase(),
        pathPattern: draft.pathPattern.trim(),
        verdict: draft.verdict,
      },
      { onSuccess: () => setDraft(EMPTY_DRAFT) },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <BackLink onClick={() => setView("list")} />
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-text">
          Egress rules
        </h1>
        <span className="text-[11px] text-text-muted">
          {agent ? agent.name : agentId}
        </span>
      </div>
      <p className="text-[12px] text-text-muted leading-relaxed max-w-prose">
        Rules decide outbound HTTP requests from this agent. The most-specific
        rule wins; <code>*</code> in <em>method</em> or <em>path</em> matches
        any value. Without a matching rule, the request goes to the inbox.
      </p>

      <div className="rounded-lg border border-border-light bg-surface overflow-hidden">
        <form onSubmit={onSubmit} className="px-3 py-3 border-b border-border-light flex flex-wrap items-end gap-2">
          <Field label="Host" widthClass="min-w-[220px] flex-1">
            <input
              value={draft.host}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              placeholder="api.anthropic.com"
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px]"
            />
          </Field>
          <Field label="Method" widthClass="w-[100px]">
            <select
              value={ALL_METHODS.includes(draft.method as (typeof ALL_METHODS)[number]) || draft.method === "*" ? draft.method : "*"}
              onChange={(e) => setDraft({ ...draft, method: e.target.value })}
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px]"
            >
              <option value="*">* (any)</option>
              {ALL_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Path" widthClass="min-w-[160px] flex-1">
            <input
              value={draft.pathPattern}
              onChange={(e) => setDraft({ ...draft, pathPattern: e.target.value })}
              placeholder="*  or  /v1/messages*"
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px] font-mono"
            />
          </Field>
          <Field label="Verdict" widthClass="w-[100px]">
            <select
              value={draft.verdict}
              onChange={(e) => setDraft({ ...draft, verdict: e.target.value as "allow" | "deny" })}
              className="w-full h-7 px-2 rounded border border-border-light bg-bg text-[12px]"
            >
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </Field>
          <button
            type="submit"
            disabled={!canSave}
            className="h-7 inline-flex items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            <Plus size={11} /> Add rule
          </button>
          {draftRequiresRestart && (
            <p className="basis-full text-[11px] text-warning">
              Saving will restart the agent (~5–15s) — path-level rules need MITM on this host.
            </p>
          )}
        </form>

        {isLoading ? (
          <p className="px-4 py-5 text-[12px] text-text-muted">loading…</p>
        ) : rules.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-text-muted">
            No rules yet. Every outbound request will surface in the inbox.
          </p>
        ) : (
          <ul className="flex flex-col">
            {rules.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                onRevoke={() => revokeRule.mutate({ id: r.id })}
                disabled={revokeRule.isPending}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="self-start inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text transition-colors"
    >
      <ArrowLeft size={11} /> Back to agents
    </button>
  );
}

function Field({
  label,
  widthClass,
  children,
}: {
  label: string;
  widthClass: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${widthClass}`}>
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function RuleRow({
  rule,
  onRevoke,
  disabled,
}: {
  rule: EgressRuleView;
  onRevoke: () => void;
  disabled: boolean;
}) {
  const verdictTone =
    rule.verdict === "allow"
      ? "text-accent border-accent/40"
      : "text-danger border-danger/40";
  const sourceLabel = formatSource(rule.source);
  return (
    <li className="border-b border-border-light px-3 py-2 flex items-center gap-2 text-[12px]">
      <span className={`uppercase tracking-wider text-[10px] rounded border px-1.5 py-0.5 ${verdictTone}`}>
        {rule.verdict}
      </span>
      <span className="font-mono text-[11px] text-text-muted w-[60px]">{rule.method}</span>
      <span className="font-medium truncate">{rule.host}</span>
      <span className="font-mono text-[11px] text-text-muted truncate">{rule.pathPattern}</span>
      {sourceLabel && (
        <span
          title={`source: ${rule.source}`}
          className="text-[10px] text-text-muted rounded border border-border-light px-1.5 py-0.5"
        >
          {sourceLabel}
        </span>
      )}
      <span className="ml-auto text-[10px] text-text-muted hidden sm:block">
        by {rule.decidedBy.slice(0, 8)}
      </span>
      <button
        onClick={onRevoke}
        disabled={disabled}
        title="Revoke rule"
        className="h-6 inline-flex items-center justify-center rounded border border-border-light text-text-muted hover:text-danger hover:border-danger px-1.5 disabled:opacity-40 transition-colors"
      >
        <Trash2 size={11} />
      </button>
    </li>
  );
}

function formatSource(source: EgressRuleView["source"]): string | null {
  if (source === "manual") return null;
  if (source === "inbox") return "from inbox";
  if (source === "preset:trusted") return "preset: trusted";
  if (source === "preset:all") return "preset: all";
  if (source.startsWith("connection:")) return `from ${source.slice("connection:".length)}`;
  return source;
}
