import { randomUUID } from "node:crypto";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";

/**
 * Reconciles `egress_rules` with the agent's currently-granted connections.
 * The secrets module owns the grant list (selective per-agent); on every
 * `setAgentAccess` call this port is invoked with the desired full state.
 *
 * Lifecycle (DRAFT-unified-hitl-ux §"Single rules table"):
 *   - Granted connection not yet in egress_rules → insert
 *     `(host, *, *, allow, source=connection:<id>)`. Skip if a `manual` or
 *     `inbox` rule already covers the host (user has taken ownership).
 *   - Connection no longer granted, but rule still active → revoke. User-
 *     promoted rows (source=manual) are not touched, since the source flip
 *     happens on the user's edit and the row is no longer matched here.
 *
 * Idempotent — calling with the same input twice is a no-op. No tombstones
 * (per ADR): grant is one-shot, not a recurring sync; if the user re-grants
 * after revoking, we skip auto-insert when a manual rule is already in
 * place, otherwise we insert fresh.
 */
export interface ConnectionRulesSync {
  syncForAgent(input: {
    agentId: string;
    decidedBy: string;
    /** All currently granted connections, keyed by connection id, value is
     *  the host the connection's credential targets. */
    grants: Map<string, { host: string }>;
  }): Promise<void>;
}

export interface CreateConnectionRulesSyncDeps {
  repo: EgressRulesRepository;
}

const SOURCE_PREFIX = "connection:";

export function createConnectionRulesSync(deps: CreateConnectionRulesSyncDeps): ConnectionRulesSync {
  return {
    async syncForAgent({ agentId, decidedBy, grants }) {
      const current = await deps.repo.listConnectionDerivedForAgent(agentId);
      const currentBySource = new Map(current.map((r) => [r.source, r]));

      // Revoke rows whose connection is no longer granted. We keep
      // user-promoted rows (source=manual) out of this loop entirely —
      // listConnectionDerivedForAgent only returns source=connection:%.
      for (const [source, row] of currentBySource) {
        const connId = source.startsWith(SOURCE_PREFIX) ? source.slice(SOURCE_PREFIX.length) : null;
        if (connId && !grants.has(connId)) {
          await deps.repo.revoke(row.id);
        }
      }

      // Insert rows for newly-granted connections, skipping when a user-
      // owned (manual/inbox) rule already covers the host.
      for (const [connId, { host }] of grants) {
        const source = `${SOURCE_PREFIX}${connId}` as const;
        if (currentBySource.has(source)) continue;
        if (await deps.repo.hasUserOwnedRuleForHost(agentId, host)) continue;
        await deps.repo.insert({
          id: randomUUID(),
          agentId,
          host,
          method: "*",
          pathPattern: "*",
          verdict: "allow",
          decidedBy,
          source,
        });
      }
    },
  };
}
