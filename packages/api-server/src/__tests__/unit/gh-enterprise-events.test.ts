import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import yaml from "js-yaml";
import {
  mountGhEnterpriseEventsRoute,
} from "../../apps/harness-api-server/gh-enterprise-events.js";
import {
  createGhEnterpriseBus,
  type GhEnterpriseHost,
} from "../../modules/connections/services/gh-enterprise-bus.js";
import {
  LABEL_AGENT_REF,
  LABEL_OWNER,
  STATUS_KEY,
} from "../../modules/agents/infrastructure/labels.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";

/**
 * Minimal K8s fake: just enough for verifyInstanceToken to resolve an instance
 * → (agent, owner) and validate a Bearer token against the agent ConfigMap's
 * status hash. Mirrors the real layout from instance-auth.ts.
 */
function fakeK8s(token: string): K8sClient {
  const hash = createHash("sha256").update(token).digest("hex");
  const instance = {
    metadata: {
      name: "i-1",
      labels: { [LABEL_AGENT_REF]: "a-1", [LABEL_OWNER]: "alice" },
    },
  };
  const agent = {
    metadata: { name: "a-1", labels: { [LABEL_OWNER]: "alice" } },
    data: { [STATUS_KEY]: yaml.dump({ accessTokenHash: hash }) },
  };
  return {
    getConfigMap: async (name: string) => {
      if (name === "i-1") return instance;
      if (name === "a-1") return agent;
      return null;
    },
  } as unknown as K8sClient;
}

/** Read the SSE response body until the predicate returns true; then abort. */
async function readUntil(
  res: Response,
  predicate: (frames: string[]) => boolean,
  ac: AbortController,
): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      frames.push(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
    if (predicate(frames)) {
      ac.abort();
      try {
        await reader.cancel();
      } catch {}
      break;
    }
  }
  return frames;
}

function parseFrame(frame: string) {
  const lines = frame.split("\n");
  const event = lines.find((l) => l.startsWith("event:"))?.slice("event:".length).trim();
  const data = lines
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trim())
    .join("\n");
  return { event, data: data ? (JSON.parse(data) as { connections: GhEnterpriseHost[] }) : null };
}

describe("gh-enterprise events SSE", () => {
  function setup(snapshot: GhEnterpriseHost[] = []) {
    const bus = createGhEnterpriseBus();
    const app = new Hono();
    mountGhEnterpriseEventsRoute(app, {
      k8s: fakeK8s("good-token"),
      bus,
      fetchSnapshot: async () => snapshot,
    });
    return { app, bus };
  }

  it("rejects requests without a Bearer token", async () => {
    const { app } = setup();
    const res = await app.request("/api/instances/i-1/gh-enterprise/events");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown instance", async () => {
    const { app } = setup();
    const res = await app.request("/api/instances/i-other/gh-enterprise/events", {
      headers: { authorization: "Bearer good-token" },
    });
    expect(res.status).toBe(404);
  });

  it("emits a snapshot event immediately on connect", async () => {
    const { app } = setup([{ host: "ghe.example.com", username: "alice" }]);
    const ac = new AbortController();
    const res = await app.request("/api/instances/i-1/gh-enterprise/events", {
      headers: { authorization: "Bearer good-token" },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    const frames = await readUntil(res, (f) => f.length >= 1, ac);
    const parsed = parseFrame(frames[0]);
    expect(parsed.event).toBe("snapshot");
    expect(parsed.data?.connections).toEqual([
      { host: "ghe.example.com", username: "alice" },
    ]);
  });

  it("streams an upsert when the bus publishes after connect", async () => {
    const { app, bus } = setup([]);
    const ac = new AbortController();
    const res = await app.request("/api/instances/i-1/gh-enterprise/events", {
      headers: { authorization: "Bearer good-token" },
      signal: ac.signal,
    });
    // Publish on the next tick so the snapshot arrives first.
    setTimeout(
      () =>
        bus.publish("a-1", {
          kind: "upsert",
          connections: [{ host: "new.example.com", username: "u" }],
        }),
      5,
    );
    const frames = await readUntil(res, (f) => f.length >= 2, ac);
    expect(parseFrame(frames[0]).event).toBe("snapshot");
    const second = parseFrame(frames[1]);
    expect(second.event).toBe("upsert");
    expect(second.data?.connections).toEqual([
      { host: "new.example.com", username: "u" },
    ]);
  });

  it("unsubscribes from the bus when the client disconnects (leak-free)", async () => {
    // Spy bus that counts subscribers — guards the regression where the parked
    // promise never woke and the unsubscribe in `finally` never ran.
    const inner = createGhEnterpriseBus();
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
    const app = new Hono();
    mountGhEnterpriseEventsRoute(app, {
      k8s: fakeK8s("good-token"),
      bus: spyBus,
      fetchSnapshot: async () => [],
    });

    const ac = new AbortController();
    const res = await app.request("/api/instances/i-1/gh-enterprise/events", {
      headers: { authorization: "Bearer good-token" },
      signal: ac.signal,
    });
    await readUntil(res, (f) => f.length >= 1, ac); // snapshot, then abort

    // Allow the abort to propagate through the streaming machinery.
    await new Promise((r) => setTimeout(r, 50));
    expect(active).toBe(0);
  });
});
