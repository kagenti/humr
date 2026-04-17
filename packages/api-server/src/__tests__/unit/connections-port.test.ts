import { describe, it, expect } from "vitest";
import { flattenApps } from "../../modules/connections/infrastructure/onecli-connections-port.js";

describe("flattenApps", () => {
  it("returns [] for non-array, non-{apps} input", () => {
    expect(flattenApps(null)).toEqual([]);
    expect(flattenApps(undefined)).toEqual([]);
    expect(flattenApps("string")).toEqual([]);
    expect(flattenApps({})).toEqual([]);
  });

  it("accepts the documented array-root shape", () => {
    const rows = flattenApps([
      {
        id: "gmail",
        name: "Gmail",
        connection: { status: "connected", connectedAt: "2026-04-17T11:17:52.183Z" },
      },
    ]);
    expect(rows).toEqual([
      {
        id: "gmail",
        provider: "gmail",
        label: "Gmail",
        status: "connected",
        scopes: null,
        connectedAt: "2026-04-17T11:17:52.183Z",
        metadata: null,
      },
    ]);
  });

  it("accepts the {apps: [...]} envelope", () => {
    const rows = flattenApps({
      apps: [
        {
          id: "google-drive",
          name: "Google Drive",
          connection: { status: "connected", connectedAt: "2026-04-17T11:17:21.688Z" },
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("google-drive");
  });

  it("drops apps with connection: null", () => {
    const rows = flattenApps([
      { id: "github", name: "GitHub", connection: null },
      {
        id: "gmail",
        name: "Gmail",
        connection: { status: "connected", connectedAt: "2026-04-17T11:17:52.183Z" },
      },
    ]);
    expect(rows.map((r) => r.provider)).toEqual(["gmail"]);
  });

  it("drops connection objects missing connectedAt (not a real connection)", () => {
    const rows = flattenApps([
      {
        id: "slack",
        name: "Slack",
        // Status present but no connectedAt — this is an app-level status, not a connection.
        connection: { status: "available" },
      },
    ]);
    expect(rows).toEqual([]);
  });

  it("captures scopes and metadata when OneCLI provides them", () => {
    const rows = flattenApps([
      {
        id: "gmail",
        name: "Gmail",
        connection: {
          status: "connected",
          connectedAt: "2026-04-17T00:00:00Z",
          scopes: ["openid", "gmail.readonly"],
          metadata: { email: "user@example.com" },
        },
      },
    ]);
    expect(rows[0].scopes).toEqual(["openid", "gmail.readonly"]);
    expect(rows[0].metadata).toEqual({ email: "user@example.com" });
  });

  it("falls back to provider when label and name are missing", () => {
    const rows = flattenApps([
      {
        id: "obscure-provider",
        connection: { status: "connected", connectedAt: "2026-01-01T00:00:00Z" },
      },
    ]);
    expect(rows[0].label).toBe("obscure-provider");
  });

  it("uses provider for id when the connection object has no id (OneCLI /api/apps)", () => {
    const rows = flattenApps([
      {
        id: "gmail",
        name: "Gmail",
        connection: { status: "connected", connectedAt: "2026-01-01T00:00:00Z" },
      },
    ]);
    expect(rows[0].id).toBe("gmail");
  });
});
