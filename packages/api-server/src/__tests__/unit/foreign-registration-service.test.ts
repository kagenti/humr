import { describe, it, expect, vi } from "vitest";
import { createForeignRegistrationService } from "../../modules/connections/services/foreign-registration-service.js";
import type { OnecliForeignCredentialsPort } from "../../modules/connections/infrastructure/onecli-foreign-credentials-port.js";

function makePort(overrides: Partial<OnecliForeignCredentialsPort> = {}): OnecliForeignCredentialsPort {
  return {
    exchangeImpersonationToken: async () => "sa-token",
    createOrFindAgent: async () => ({ accessToken: "agent-tok" }),
    ...overrides,
  };
}

describe("ForeignRegistrationService", () => {
  it("mints a fresh token via exchange + createOrFindAgent on first call", async () => {
    const exchange = vi.fn<OnecliForeignCredentialsPort["exchangeImpersonationToken"]>(
      async () => "sa-token",
    );
    const createOrFind = vi.fn<OnecliForeignCredentialsPort["createOrFindAgent"]>(
      async () => ({ accessToken: "agent-tok" }),
    );
    const svc = createForeignRegistrationService({
      port: makePort({ exchangeImpersonationToken: exchange, createOrFindAgent: createOrFind }),
    });

    const result = await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accessToken).toBe("agent-tok");
    expect(result.value.agentIdentifier).toMatch(/^fork-inst-a-[a-f0-9]{12}$/);
    expect(exchange).toHaveBeenCalledWith("kc|u1");
    expect(createOrFind).toHaveBeenCalledTimes(1);
    const firstCallArgs = createOrFind.mock.calls[0]?.[0];
    expect(firstCallArgs?.onecliToken).toBe("sa-token");
    expect(firstCallArgs?.identifier).toBe(result.value.agentIdentifier);
  });

  it("returns cached token on second call with same (instance, foreignSub)", async () => {
    const exchange = vi.fn(async () => "sa-token");
    const createOrFind = vi.fn(async () => ({ accessToken: "agent-tok" }));
    const svc = createForeignRegistrationService({
      port: makePort({ exchangeImpersonationToken: exchange, createOrFindAgent: createOrFind }),
    });

    await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });
    const second = await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.accessToken).toBe("agent-tok");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(createOrFind).toHaveBeenCalledTimes(1);
  });

  it("does not share cache across different instances", async () => {
    const exchange = vi.fn(async () => "sa-token");
    const createOrFind = vi.fn(async () => ({ accessToken: "agent-tok" }));
    const svc = createForeignRegistrationService({
      port: makePort({ exchangeImpersonationToken: exchange, createOrFindAgent: createOrFind }),
    });

    await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });
    await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-b" });

    expect(exchange).toHaveBeenCalledTimes(2);
    expect(createOrFind).toHaveBeenCalledTimes(2);
  });

  it("maps token exchange failure to TokenExchangeFailed", async () => {
    const svc = createForeignRegistrationService({
      port: makePort({
        exchangeImpersonationToken: async () => {
          throw new Error("keycloak 401");
        },
      }),
    });

    const result = await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });

    expect(result).toEqual({
      ok: false,
      error: { kind: "TokenExchangeFailed", detail: "keycloak 401" },
    });
  });

  it("maps createOrFindAgent failure to OnecliRegistrationFailed", async () => {
    const svc = createForeignRegistrationService({
      port: makePort({
        createOrFindAgent: async () => {
          throw new Error("onecli 500");
        },
      }),
    });

    const result = await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });

    expect(result).toEqual({
      ok: false,
      error: { kind: "OnecliRegistrationFailed", detail: "onecli 500" },
    });
  });

  it("does not cache failures — next call retries", async () => {
    let calls = 0;
    const svc = createForeignRegistrationService({
      port: makePort({
        exchangeImpersonationToken: async () => {
          calls += 1;
          if (calls === 1) throw new Error("transient");
          return "sa-token";
        },
      }),
    });

    const first = await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });
    expect(first.ok).toBe(false);

    const second = await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.accessToken).toBe("agent-tok");
  });

  it("evict() causes next call to re-mint", async () => {
    const exchange = vi.fn(async () => "sa-token");
    const svc = createForeignRegistrationService({
      port: makePort({ exchangeImpersonationToken: exchange }),
    });

    await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });
    svc.evict({ foreignSub: "kc|u1", instanceId: "inst-a" });
    await svc.mintForeignToken({ foreignSub: "kc|u1", instanceId: "inst-a" });

    expect(exchange).toHaveBeenCalledTimes(2);
  });
});
