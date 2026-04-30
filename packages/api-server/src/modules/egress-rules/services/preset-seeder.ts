import { randomUUID } from "node:crypto";
import type { EgressPreset } from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";

/**
 * Translates an agent-create preset into a batch of `egress_rules`
 * inserts. Idempotent in the steady state — repository inserts are
 * `ON CONFLICT DO NOTHING` against the `(agent, host, method, path)`
 * unique index, so reseeding the same preset is safe (e.g. if the
 * agent-create flow retries).
 *
 * The seeder is decoupled from the `EgressRulesService` because:
 *   - It runs in the agent-create flow under the *system* identity, not
 *     a user-scoped service.
 *   - It writes rules with `source = preset:<name>`, not `manual`.
 *   - It bypasses the agent-ownership check (the agent is being created
 *     in the same atomic flow; ownership is implied).
 */
export interface PresetSeeder {
  seed(agentId: string, preset: EgressPreset, decidedBy: string): Promise<void>;
}

export interface CreatePresetSeederDeps {
  repo: EgressRulesRepository;
  /** Loaded once at boot from the helm-mounted trusted-hosts file. */
  trustedHosts: readonly string[];
}

export function createPresetSeeder(deps: CreatePresetSeederDeps): PresetSeeder {
  return {
    async seed(agentId, preset, decidedBy) {
      if (preset === "none") return;
      if (preset === "all") {
        await deps.repo.insert({
          id: randomUUID(),
          agentId,
          host: "*",
          method: "*",
          pathPattern: "*",
          verdict: "allow",
          decidedBy,
          source: "preset:all",
        });
        return;
      }
      // `trusted`: one row per host. The list is small (~25 entries) and
      // changes rarely, so a per-row insert keeps the code simple. Each
      // hits the unique-index conflict path on retry, no rollback needed.
      for (const host of deps.trustedHosts) {
        await deps.repo.insert({
          id: randomUUID(),
          agentId,
          host,
          method: "*",
          pathPattern: "*",
          verdict: "allow",
          decidedBy,
          source: "preset:trusted",
        });
      }
    },
  };
}
