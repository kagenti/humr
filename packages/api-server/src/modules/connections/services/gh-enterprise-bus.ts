/**
 * In-memory pub/sub for github-enterprise hosts.yml events.
 *
 * Single api-server replica is the deployment baseline. Topics are keyed by
 * agent name (matches OneCLI's grant scope); the harness-side SSE handler
 * resolves instance → agent before subscribing, and the connections-service
 * publishes by agent on any setAgentConnections call that touches a
 * github-enterprise grant.
 */

export interface GhEnterpriseHost {
  host: string;
  username?: string;
}

export interface GhEnterpriseEvent {
  /** "snapshot" on initial SSE connect; "upsert" on grant changes. */
  kind: "snapshot" | "upsert";
  connections: GhEnterpriseHost[];
}

export interface GhEnterpriseBus {
  subscribe(agentName: string, cb: (e: GhEnterpriseEvent) => void): () => void;
  publish(agentName: string, e: GhEnterpriseEvent): void;
}

export function createGhEnterpriseBus(): GhEnterpriseBus {
  const subs = new Map<string, Set<(e: GhEnterpriseEvent) => void>>();
  return {
    subscribe(agentName, cb) {
      let set = subs.get(agentName);
      if (!set) {
        set = new Set();
        subs.set(agentName, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
        if (set && set.size === 0) subs.delete(agentName);
      };
    },
    publish(agentName, e) {
      const set = subs.get(agentName);
      if (!set) return;
      for (const cb of set) {
        try {
          cb(e);
        } catch {
          // Subscribers must isolate their own errors; we don't tear down the bus.
        }
      }
    },
  };
}
