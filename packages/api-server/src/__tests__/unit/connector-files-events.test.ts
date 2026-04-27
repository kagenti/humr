import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import yaml from "js-yaml";
import { mountConnectorFilesEventsRoute } from "../../apps/harness-api-server/connector-files-events.js";
import { createConnectorFilesBus } from "../../modules/connector-files/bus.js";
import {
  LABEL_AGENT_REF,
  LABEL_OWNER,
  STATUS_KEY,
} from "../../modules/agents/infrastructure/labels.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

/**
 * Regression guard for the disconnect leak: without `stream.onAbort`, the
 * subscriber set kept growing on every reconnect because the parked Promise
 * never woke and the `finally`-side `unsubscribe` never ran.
 */
describe("connector-files events SSE", () => {
  it("unsubscribes from the bus when the client disconnects", async () => {
    const inner = createConnectorFilesBus();
    let active = 0;
    const spyBus = {
      subscribe(agentName: string, cb: Parameters<typeof inner.subscribe>[1]) {
        active++;
        const unsub = inner.subscribe(agentName, cb);
        return () => {
          active--;
          unsub();
        };
      },
      publish: inner.publish.bind(inner),
    };

    const token = "good-token";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const k8s = {
      getConfigMap: async (name: string) => {
        if (name === "i-1") {
          return {
            metadata: {
              name: "i-1",
              labels: { [LABEL_AGENT_REF]: "a-1", [LABEL_OWNER]: "alice" },
            },
          };
        }
        if (name === "a-1") {
          return {
            metadata: { name: "a-1", labels: { [LABEL_OWNER]: "alice" } },
            data: { [STATUS_KEY]: yaml.dump({ accessTokenHash: tokenHash }) },
          };
        }
        return null;
      },
    } as unknown as K8sClient;

    const app = new Hono();
    mountConnectorFilesEventsRoute(app, {
      k8s,
      bus: spyBus,
      fetchSnapshot: async () => [],
    });

    const ac = new AbortController();
    const res = await app.request("/api/instances/i-1/connector-files/events", {
      headers: { authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (!buf.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    ac.abort();
    try {
      await reader.cancel();
    } catch {}

    await new Promise((r) => setTimeout(r, 50));
    expect(active).toBe(0);
  });
});
