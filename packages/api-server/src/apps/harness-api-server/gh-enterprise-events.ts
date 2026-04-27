import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  GhEnterpriseBus,
  GhEnterpriseHost,
} from "../../modules/connections/services/gh-enterprise-bus.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { verifyInstanceToken } from "./instance-auth.js";

export interface GhEnterpriseEventsDeps {
  k8s: K8sClient;
  bus: GhEnterpriseBus;
  /** Returns the github-enterprise hosts currently granted to the owner. */
  fetchSnapshot: (owner: string) => Promise<GhEnterpriseHost[]>;
}

/**
 * Mount the SSE channel that the agent-pod sidecar holds open.
 * Auth: Bearer token (per-instance). Topics: keyed by agent name; multiple
 * instances of the same agent receive identical events.
 */
export function mountGhEnterpriseEventsRoute(app: Hono, deps: GhEnterpriseEventsDeps) {
  app.get("/api/instances/:id/gh-enterprise/events", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice(7);
    const instanceId = c.req.param("id")!;
    const identity = await verifyInstanceToken(deps.k8s, instanceId, token);
    if (!identity) return c.json({ error: "not found" }, 404);

    const { agentName, owner } = identity;
    return streamSSE(c, async (stream) => {
      // Subscriber registered before the snapshot fetch so we don't miss an
      // upsert that happens during the fetch.
      const queue: GhEnterpriseHost[][] = [];
      let resolveWaiter: (() => void) | null = null;
      const wakeWaiter = () => {
        const r = resolveWaiter;
        resolveWaiter = null;
        r?.();
      };
      const unsubscribe = deps.bus.subscribe(agentName, (e) => {
        queue.push(e.connections);
        wakeWaiter();
      });

      try {
        const snapshot = await deps.fetchSnapshot(owner).catch((err) => {
          console.warn(`gh-enterprise snapshot for ${owner} failed:`, err);
          return [] as GhEnterpriseHost[];
        });
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify({ connections: snapshot }),
        });

        // Drain loop: emit any queued upserts, then wait for new ones or for
        // the client to disconnect (stream.aborted is set by Hono on close).
        while (!stream.aborted) {
          while (queue.length > 0) {
            const conns = queue.shift()!;
            await stream.writeSSE({
              event: "upsert",
              data: JSON.stringify({ connections: conns }),
            });
          }
          await new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });
}
