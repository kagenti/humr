import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildForkIdentifier,
  createOnecliForeignCredentialsPort,
  type OnecliForeignCredentialsConfig,
} from "../../modules/connections/infrastructure/onecli-foreign-credentials-port.js";

interface Route {
  status: number;
  body: unknown;
}

function installFetchMock(routes: Record<string, Route | Route[]>) {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const roundRobin = new Map<string, number>();

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    let bodyString: string | undefined;
    if (typeof init?.body === "string") bodyString = init.body;
    else if (init?.body instanceof URLSearchParams) bodyString = init.body.toString();
    calls.push({ url, method, body: bodyString });

    const route = routes[key] ?? routes[url];
    if (!route) {
      return new Response(JSON.stringify({ error: `unstubbed ${key}` }), { status: 500 });
    }
    if (Array.isArray(route)) {
      const idx = roundRobin.get(key) ?? 0;
      const chosen = route[Math.min(idx, route.length - 1)];
      roundRobin.set(key, idx + 1);
      return new Response(JSON.stringify(chosen.body), { status: chosen.status });
    }
    return new Response(JSON.stringify(route.body), { status: route.status });
  });

  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

const config: OnecliForeignCredentialsConfig = {
  keycloakTokenUrl: "http://kc/token",
  clientId: "humr-api",
  clientSecret: "s3cret",
  onecliAudience: "onecli",
  onecliBaseUrl: "http://onecli",
};

describe("buildForkIdentifier", () => {
  it("produces a stable, url-safe identifier", () => {
    const id = buildForkIdentifier("inst-a", "kc|u1");
    expect(id).toMatch(/^fork-inst-a-[a-f0-9]{12}$/);
    expect(buildForkIdentifier("inst-a", "kc|u1")).toBe(id);
  });

  it("differs by foreignSub", () => {
    expect(buildForkIdentifier("inst-a", "kc|u1")).not.toBe(
      buildForkIdentifier("inst-a", "kc|u2"),
    );
  });
});

describe("onecli-foreign-credentials-port", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchangeImpersonationToken performs two-step RFC 8693 flow", async () => {
    const { calls } = installFetchMock({
      "POST http://kc/token": [
        { status: 200, body: { access_token: "sa-tok", expires_in: 60 } },
        { status: 200, body: { access_token: "user-tok", expires_in: 60 } },
      ],
    });

    const port = createOnecliForeignCredentialsPort(config);
    const token = await port.exchangeImpersonationToken("kc|u1");

    expect(token).toBe("user-tok");
    expect(calls.length).toBe(2);

    const saBody = new URLSearchParams(calls[0].body!);
    expect(saBody.get("grant_type")).toBe("client_credentials");
    expect(saBody.get("client_id")).toBe("humr-api");

    const exchangeBody = new URLSearchParams(calls[1].body!);
    expect(exchangeBody.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(exchangeBody.get("subject_token")).toBe("sa-tok");
    expect(exchangeBody.get("requested_subject")).toBe("kc|u1");
    expect(exchangeBody.get("audience")).toBe("onecli");
  });

  it("exchangeImpersonationToken throws on Keycloak !ok", async () => {
    installFetchMock({
      "POST http://kc/token": { status: 401, body: { error: "bad" } },
    });

    const port = createOnecliForeignCredentialsPort(config);
    await expect(port.exchangeImpersonationToken("kc|u1")).rejects.toThrow(/401/);
  });

  it("createOrFindAgent returns accessToken from POST /api/agents on 200 and sets secret-mode=all", async () => {
    const { calls } = installFetchMock({
      "POST http://onecli/api/agents": {
        status: 200,
        body: { id: "a-1", accessToken: "at-123", identifier: "fork-x-abc" },
      },
      "PATCH http://onecli/api/agents/a-1/secret-mode": { status: 200, body: {} },
    });

    const port = createOnecliForeignCredentialsPort(config);
    const result = await port.createOrFindAgent({
      onecliToken: "onecli-tok",
      identifier: "fork-x-abc",
      displayName: "Fork X",
    });

    expect(result).toEqual({ accessToken: "at-123" });
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body!)).toEqual({ name: "Fork X", identifier: "fork-x-abc" });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("http://onecli/api/agents/a-1/secret-mode");
    expect(JSON.parse(patch!.body!)).toEqual({ mode: "all" });
  });

  it("falls back to listing agents when POST /api/agents returns 409 and re-applies secret-mode=all", async () => {
    const { calls } = installFetchMock({
      "POST http://onecli/api/agents": { status: 409, body: { error: "exists" } },
      "http://onecli/api/agents": {
        status: 200,
        body: [
          { id: "a-1", identifier: "other", accessToken: "wrong" },
          { id: "a-2", identifier: "fork-x-abc", accessToken: "right" },
        ],
      },
      "PATCH http://onecli/api/agents/a-2/secret-mode": { status: 200, body: {} },
    });

    const port = createOnecliForeignCredentialsPort(config);
    const result = await port.createOrFindAgent({
      onecliToken: "onecli-tok",
      identifier: "fork-x-abc",
      displayName: "Fork X",
    });

    expect(result).toEqual({ accessToken: "right" });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe("http://onecli/api/agents/a-2/secret-mode");
  });

  it("falls back to listing agents when POST /api/agents response lacks accessToken", async () => {
    installFetchMock({
      "POST http://onecli/api/agents": { status: 200, body: { id: "a-2" } },
      "http://onecli/api/agents": {
        status: 200,
        body: [{ id: "a-2", identifier: "fork-x-abc", accessToken: "right" }],
      },
      "PATCH http://onecli/api/agents/a-2/secret-mode": { status: 200, body: {} },
    });

    const port = createOnecliForeignCredentialsPort(config);
    const result = await port.createOrFindAgent({
      onecliToken: "onecli-tok",
      identifier: "fork-x-abc",
      displayName: "Fork X",
    });

    expect(result).toEqual({ accessToken: "right" });
  });

  it("throws on 409 if list lookup cannot find the identifier", async () => {
    installFetchMock({
      "POST http://onecli/api/agents": { status: 409, body: {} },
      "http://onecli/api/agents": { status: 200, body: [] },
    });

    const port = createOnecliForeignCredentialsPort(config);
    await expect(
      port.createOrFindAgent({
        onecliToken: "onecli-tok",
        identifier: "fork-x-abc",
        displayName: "Fork X",
      }),
    ).rejects.toThrow(/fork-x-abc/);
  });

  it("throws on OneCLI non-200, non-409 create response", async () => {
    installFetchMock({
      "POST http://onecli/api/agents": { status: 500, body: { error: "boom" } },
    });

    const port = createOnecliForeignCredentialsPort(config);
    await expect(
      port.createOrFindAgent({
        onecliToken: "onecli-tok",
        identifier: "fork-x-abc",
        displayName: "Fork X",
      }),
    ).rejects.toThrow(/500/);
  });
});
