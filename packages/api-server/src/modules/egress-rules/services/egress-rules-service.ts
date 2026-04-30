import { randomUUID } from "node:crypto";
import type {
  CreateEgressRuleInput,
  EgressRuleView,
  EgressRulesService,
  UpdateEgressRuleInput,
} from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../domain/types.js";

export interface CreateEgressRulesServiceDeps {
  repo: EgressRulesRepository;
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  ownerSub: string;
}

function toView(row: EgressRuleRow): EgressRuleView {
  return {
    id: row.id,
    agentId: row.agentId,
    host: row.host,
    method: row.method,
    pathPattern: row.pathPattern,
    verdict: row.verdict,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
    source: row.source,
  };
}

export function createEgressRulesService(deps: CreateEgressRulesServiceDeps): EgressRulesService {
  return {
    async listForAgent(agentId) {
      if (!await deps.isAgentOwnedBy(agentId, deps.ownerSub)) return [];
      const rows = await deps.repo.listForAgent(agentId);
      return rows.map(toView);
    },

    async create(input: CreateEgressRuleInput) {
      if (!await deps.isAgentOwnedBy(input.agentId, deps.ownerSub)) {
        throw new Error("agent not found");
      }
      const row = await deps.repo.insert({
        id: randomUUID(),
        agentId: input.agentId,
        host: input.host,
        method: input.method,
        pathPattern: input.pathPattern,
        verdict: input.verdict,
        decidedBy: deps.ownerSub,
        source: "manual",
      });
      return toView(row);
    },

    async update(input: UpdateEgressRuleInput) {
      const rule = await deps.repo.getById(input.id);
      if (!rule || !await deps.isAgentOwnedBy(rule.agentId, deps.ownerSub)) {
        throw new Error("egress rule not found");
      }
      const updated = await deps.repo.updatePromoteToManual({
        id: input.id,
        method: input.method,
        pathPattern: input.pathPattern,
        verdict: input.verdict,
        decidedBy: deps.ownerSub,
      });
      if (!updated) throw new Error("egress rule not found");
      return toView(updated);
    },

    async revoke(id) {
      const rule = await deps.repo.getById(id);
      if (!rule || !await deps.isAgentOwnedBy(rule.agentId, deps.ownerSub)) return;
      await deps.repo.revoke(id);
    },
  };
}
