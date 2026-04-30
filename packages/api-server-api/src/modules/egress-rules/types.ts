export type RuleVerdict = "allow" | "deny";

/**
 * Origin of a rule row. User edits/deletes flip non-`manual` rows to
 * `manual` so later connection revokes / preset reseeds don't undo a
 * deliberate user decision. The UI reads non-`manual` sources to render the
 * "(was from …)" annotation. See DRAFT-unified-hitl-ux.
 */
export type EgressRuleSource =
  | "manual"
  | "inbox"
  | `connection:${string}`
  | "preset:trusted"
  | "preset:all";

export interface EgressRuleView {
  id: string;
  agentId: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  decidedAt: string;
  source: EgressRuleSource;
}

export interface CreateEgressRuleInput {
  agentId: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
}

export interface UpdateEgressRuleInput {
  id: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
}

export interface EgressRulesService {
  listForAgent(agentId: string): Promise<EgressRuleView[]>;
  /** Always writes `source = 'manual'`. */
  create(input: CreateEgressRuleInput): Promise<EgressRuleView>;
  /** Flips `source` to `'manual'` even if the row was previously
   *  connection- or preset-derived. Mirrors how connection-injected envs
   *  become user-owned on edit. */
  update(input: UpdateEgressRuleInput): Promise<EgressRuleView>;
  revoke(id: string): Promise<void>;
}
