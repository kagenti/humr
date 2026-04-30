export type RuleVerdict = "allow" | "deny";

/**
 * Bulk-seeding preset chosen at agent creation. Each preset writes 0..N
 * `egress_rules` rows with `source = preset:<name>` (or no rows at all
 * for `none`). After seeding the rows are owned by the agent — editing
 * any row promotes it to `manual` like a connection-derived rule.
 *
 * - `none` — no rules. Every egress hits the inbox until the user approves.
 * - `trusted` — Anthropic-published default-allowed list (npm, PyPI,
 *   GitHub, package mirrors, etc.). Recommended default.
 * - `all` — single wildcard rule the L4 gate matches for every SNI.
 *   Development escape hatch with a UI warning.
 */
export type EgressPreset = "none" | "trusted" | "all";

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
