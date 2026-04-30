export type RuleVerdict = "allow" | "deny";

export interface EgressRuleView {
  id: string;
  agentId: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  decidedAt: string;
}

export interface CreateEgressRuleInput {
  agentId: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
}

export interface EgressRulesService {
  listForAgent(agentId: string): Promise<EgressRuleView[]>;
  create(input: CreateEgressRuleInput): Promise<EgressRuleView>;
  revoke(id: string): Promise<void>;
}
