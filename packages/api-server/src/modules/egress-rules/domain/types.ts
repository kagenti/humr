import type { RuleVerdict } from "api-server-api";

export interface EgressRuleRow {
  id: string;
  agentId: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  decidedAt: Date;
  status: "active" | "revoked";
}
