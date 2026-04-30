import type { Db } from "db";
import type { EgressRuleSource, EgressRulesService, RuleVerdict } from "api-server-api";
import { createEgressRulesRepository } from "./infrastructure/egress-rules-repository.js";
import { createEgressRulesService } from "./services/egress-rules-service.js";

export interface ComposeEgressRulesDeps {
  db: Db;
  ownerSub: string;
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
}

export function composeEgressRulesModule(deps: ComposeEgressRulesDeps): {
  service: EgressRulesService;
} {
  const repo = createEgressRulesRepository(deps.db);
  const service = createEgressRulesService({
    repo,
    isAgentOwnedBy: deps.isAgentOwnedBy,
    ownerSub: deps.ownerSub,
  });
  return { service };
}

/**
 * System-level read adapter consumed by the approvals module's ext_authz
 * gate on the egress hot path. Stateless and not owner-scoped — owner
 * scoping is structural via the agent ConfigMap, not a per-query filter.
 */
export interface EgressRuleMatchAdapter {
  match(
    agentId: string,
    host: string,
    method: string,
    path: string,
  ): Promise<{ verdict: RuleVerdict } | null>;
}

export function createEgressRuleMatchAdapter(db: Db): EgressRuleMatchAdapter {
  const repo = createEgressRulesRepository(db);
  return {
    async match(agentId, host, method, path) {
      const row = await repo.findMatch(agentId, host, method, path);
      return row ? { verdict: row.verdict } : null;
    },
  };
}

/**
 * System-level write adapter consumed by the approvals module's
 * approve-permanent / deny-forever paths. Narrow port — only `insert`,
 * matching the `EgressRuleWriter` interface declared on the consumer side.
 */
export interface EgressRuleWriterAdapter {
  insert(input: {
    id: string;
    agentId: string;
    host: string;
    method: string;
    pathPattern: string;
    verdict: RuleVerdict;
    decidedBy: string;
    source: EgressRuleSource;
  }): Promise<void>;
}

export function createEgressRuleWriterAdapter(db: Db): EgressRuleWriterAdapter {
  const repo = createEgressRulesRepository(db);
  return {
    async insert(input) {
      await repo.insert(input);
    },
  };
}
