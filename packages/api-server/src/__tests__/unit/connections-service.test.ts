import { describe, it, expect } from "vitest";
import {
  createConnectionsService,
  extractIdentity,
  normalizeStatus,
} from "../../modules/connections/services/connections-service.js";
import type {
  OnecliAgent,
  OnecliAppConnection,
  OnecliConnectionsPort,
} from "../../modules/connections/infrastructure/onecli-connections-port.js";

function makePort(overrides: Partial<OnecliConnectionsPort> = {}): OnecliConnectionsPort {
  return {
    listAppConnections: async () => [],
    findAgentByIdentifier: async () => null,
    getAgentAppConnectionIds: async () => [],
    setAgentAppConnectionIds: async () => {},
    ...overrides,
  };
}

describe("normalizeStatus", () => {
  it("maps known statuses exactly", () => {
    expect(normalizeStatus("connected")).toBe("connected");
    expect(normalizeStatus("expired")).toBe("expired");
    expect(normalizeStatus("disconnected")).toBe("disconnected");
    expect(normalizeStatus("revoked")).toBe("disconnected");
  });

  it("is case-insensitive", () => {
    expect(normalizeStatus("EXPIRED")).toBe("expired");
    expect(normalizeStatus("Revoked")).toBe("disconnected");
  });

  it("defaults missing/empty to connected", () => {
    expect(normalizeStatus(undefined)).toBe("connected");
    expect(normalizeStatus(null)).toBe("connected");
  });

  it("returns unknown for unrecognized values so the UI doesn't show a false-green badge", () => {
    expect(normalizeStatus("pending")).toBe("unknown");
    expect(normalizeStatus("syncing")).toBe("unknown");
    expect(normalizeStatus("🤷")).toBe("unknown");
  });
});

describe("extractIdentity", () => {
  it("prefers email over all other fields", () => {
    expect(
      extractIdentity({ email: "a@b.com", login: "alice", username: "al" }),
    ).toBe("a@b.com");
  });

  it("falls back through login, username, handle, name, account in that order", () => {
    expect(extractIdentity({ login: "alice" })).toBe("alice");
    expect(extractIdentity({ username: "al" })).toBe("al");
    expect(extractIdentity({ handle: "@al" })).toBe("@al");
    expect(extractIdentity({ name: "Alice" })).toBe("Alice");
    expect(extractIdentity({ account: "acct-1" })).toBe("acct-1");
  });

  it("returns undefined when metadata is null/undefined/empty", () => {
    expect(extractIdentity(null)).toBeUndefined();
    expect(extractIdentity(undefined)).toBeUndefined();
    expect(extractIdentity({})).toBeUndefined();
  });

  it("skips empty-string and non-string values", () => {
    expect(extractIdentity({ email: "", login: "alice" })).toBe("alice");
    expect(extractIdentity({ email: 42, login: "alice" })).toBe("alice");
  });
});

describe("ConnectionsService.list", () => {
  const conn: OnecliAppConnection = {
    id: "c-1",
    provider: "gmail",
    label: "user@example.com",
    status: "connected",
    scopes: ["openid"],
    metadata: { email: "user@example.com" },
    connectedAt: "2026-04-17T00:00:00Z",
  };

  it("maps a single connection row through all normalizers", async () => {
    const svc = createConnectionsService({
      port: makePort({ listAppConnections: async () => [conn] }),
    });
    const rows = await svc.list();
    expect(rows).toEqual([
      {
        id: "c-1",
        provider: "gmail",
        label: "user@example.com",
        status: "connected",
        identity: "user@example.com",
        scopes: ["openid"],
        connectedAt: "2026-04-17T00:00:00Z",
      },
    ]);
  });

  it("falls back to provider when label is missing or whitespace", async () => {
    const svc = createConnectionsService({
      port: makePort({
        listAppConnections: async () => [
          { ...conn, label: null },
          { ...conn, id: "c-2", label: "   " },
        ],
      }),
    });
    const rows = await svc.list();
    expect(rows[0].label).toBe("gmail");
    expect(rows[1].label).toBe("gmail");
  });

  it("omits optional scopes and connectedAt when absent", async () => {
    const svc = createConnectionsService({
      port: makePort({
        listAppConnections: async () => [
          { ...conn, scopes: null, connectedAt: null },
        ],
      }),
    });
    const rows = await svc.list();
    expect(rows[0]).not.toHaveProperty("scopes");
    expect(rows[0]).not.toHaveProperty("connectedAt");
  });

  it("filters out rows missing id or provider", async () => {
    const svc = createConnectionsService({
      port: makePort({
        listAppConnections: async () => [
          { ...conn },
          { ...conn, id: undefined as unknown as string },
          { ...conn, provider: undefined as unknown as string },
        ],
      }),
    });
    const rows = await svc.list();
    expect(rows).toHaveLength(1);
  });
});

describe("ConnectionsService.getAgentConnections", () => {
  it("returns empty list when the agent is not registered in OneCLI", async () => {
    const svc = createConnectionsService({
      port: makePort({ findAgentByIdentifier: async () => null }),
    });
    expect(await svc.getAgentConnections("not-synced")).toEqual({
      connectionIds: [],
    });
  });

  it("returns the id list from OneCLI when the agent is found", async () => {
    const agent: OnecliAgent = { id: "uuid", identifier: "my-agent" };
    const svc = createConnectionsService({
      port: makePort({
        findAgentByIdentifier: async (identifier) =>
          identifier === "my-agent" ? agent : null,
        getAgentAppConnectionIds: async (uuid) =>
          uuid === "uuid" ? ["c-1", "c-2"] : [],
      }),
    });
    expect(await svc.getAgentConnections("my-agent")).toEqual({
      connectionIds: ["c-1", "c-2"],
    });
  });
});

describe("ConnectionsService.setAgentConnections", () => {
  it("throws when the agent is not registered in OneCLI", async () => {
    const svc = createConnectionsService({
      port: makePort({ findAgentByIdentifier: async () => null }),
    });
    await expect(
      svc.setAgentConnections("not-synced", ["c-1"]),
    ).rejects.toThrow(/not found in OneCLI/);
  });

  it("writes deduplicated ids through the port when the agent is found", async () => {
    const agent: OnecliAgent = { id: "uuid", identifier: "my-agent" };
    const calls: { uuid: string; ids: string[] }[] = [];
    const svc = createConnectionsService({
      port: makePort({
        findAgentByIdentifier: async () => agent,
        setAgentAppConnectionIds: async (uuid, ids) => {
          calls.push({ uuid, ids });
        },
      }),
    });
    await svc.setAgentConnections("my-agent", ["c-1", "c-2", "c-1"]);
    expect(calls).toEqual([{ uuid: "uuid", ids: ["c-1", "c-2"] }]);
  });

  it("forwards an empty list (unassign all)", async () => {
    const agent: OnecliAgent = { id: "uuid", identifier: "my-agent" };
    const calls: { uuid: string; ids: string[] }[] = [];
    const svc = createConnectionsService({
      port: makePort({
        findAgentByIdentifier: async () => agent,
        setAgentAppConnectionIds: async (uuid, ids) => {
          calls.push({ uuid, ids });
        },
      }),
    });
    await svc.setAgentConnections("my-agent", []);
    expect(calls).toEqual([{ uuid: "uuid", ids: [] }]);
  });
});
