import { describe, it, expect } from "vitest";
import { createOnecliConnectionsPort } from "../../modules/connections/infrastructure/onecli-connections-port.js";

interface FakeCall {
  path: string;
  init?: RequestInit;
}

function makeFakeOc(
  responses: Record<string, { ok: boolean; body: unknown; status?: number }>,
) {
  const calls: FakeCall[] = [];
  const client = {
    exchangeToken: async () => "tok",
    getApiKey: async () => "key",
    syncUser: async () => {},
    async onecliFetch(_jwt: string, _sub: string, path: string, init?: RequestInit) {
      calls.push({ path, init });
      const match = responses[path];
      if (!match) {
        return new Response(JSON.stringify({ error: "not stubbed" }), { status: 500 });
      }
      return new Response(JSON.stringify(match.body), {
        status: match.status ?? (match.ok ? 200 : 500),
      });
    },
  };
  return { client, calls };
}

describe("onecli-connections-port", () => {
  it("listAppConnections passes through OneCLI's /api/connections response", async () => {
    const { client } = makeFakeOc({
      "/api/connections": {
        ok: true,
        body: [
          {
            id: "conn-1",
            provider: "gmail",
            label: "user@example.com",
            status: "connected",
            scopes: ["openid", "gmail.readonly"],
            metadata: { email: "user@example.com" },
            connectedAt: "2026-04-17T11:17:52.183Z",
          },
        ],
      },
    });
    const port = createOnecliConnectionsPort(client, "jwt", "sub");
    const rows = await port.listAppConnections();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("conn-1");
    expect(rows[0].metadata).toEqual({ email: "user@example.com" });
  });

  it("listAppConnections returns [] when the response is not an array", async () => {
    const { client } = makeFakeOc({
      "/api/connections": { ok: true, body: { unexpected: true } },
    });
    const port = createOnecliConnectionsPort(client, "jwt", "sub");
    expect(await port.listAppConnections()).toEqual([]);
  });

  it("listAppConnections throws on a non-OK response", async () => {
    const { client } = makeFakeOc({
      "/api/connections": { ok: false, body: { error: "boom" }, status: 500 },
    });
    const port = createOnecliConnectionsPort(client, "jwt", "sub");
    await expect(port.listAppConnections()).rejects.toThrow(/OneCLI GET \/api\/connections/);
  });

  it("findAgentByIdentifier matches on the identifier field", async () => {
    const { client } = makeFakeOc({
      "/api/agents": {
        ok: true,
        body: [
          { id: "uuid-a", identifier: "other" },
          { id: "uuid-b", identifier: "my-agent" },
        ],
      },
    });
    const port = createOnecliConnectionsPort(client, "jwt", "sub");
    const agent = await port.findAgentByIdentifier("my-agent");
    expect(agent).toEqual({ id: "uuid-b", identifier: "my-agent" });
  });

  it("findAgentByIdentifier returns null when no match", async () => {
    const { client } = makeFakeOc({
      "/api/agents": { ok: true, body: [{ id: "uuid-a", identifier: "other" }] },
    });
    const port = createOnecliConnectionsPort(client, "jwt", "sub");
    expect(await port.findAgentByIdentifier("missing")).toBeNull();
  });

  it("getAgentAppConnectionIds returns the id list and encodes the agent id", async () => {
    const { client, calls } = makeFakeOc({
      "/api/agents/uuid%2Fodd/connections": {
        ok: true,
        body: ["conn-1", "conn-2"],
      },
    });
    const port = createOnecliConnectionsPort(client, "jwt", "sub");
    const ids = await port.getAgentAppConnectionIds("uuid/odd");
    expect(ids).toEqual(["conn-1", "conn-2"]);
    expect(calls[0].path).toBe("/api/agents/uuid%2Fodd/connections");
  });

  it("getAgentAppConnectionIds filters out non-string entries defensively", async () => {
    const { client } = makeFakeOc({
      "/api/agents/abc/connections": {
        ok: true,
        body: ["conn-1", null, 42, "conn-2"],
      },
    });
    const port = createOnecliConnectionsPort(client, "jwt", "sub");
    const ids = await port.getAgentAppConnectionIds("abc");
    expect(ids).toEqual(["conn-1", "conn-2"]);
  });
});
