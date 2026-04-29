import { describe, it, expect, vi } from "vitest";

import { createSecretsService } from "../../modules/secrets/services/secrets-service.js";
import type {
  OnecliSecret,
  OnecliSecretsPort,
} from "../../modules/secrets/infrastructure/onecli-secrets-port.js";
import type { K8sSecretsPort } from "../../modules/secrets/infrastructure/k8s-secrets-port.js";

function fakeOnecliPort(seed?: Partial<OnecliSecret>): OnecliSecretsPort {
  const base: OnecliSecret = {
    id: "abc-123",
    name: "test-secret",
    type: "generic",
    hostPattern: "api.example.com",
    createdAt: "2026-04-28T00:00:00Z",
    ...seed,
  };
  return {
    listSecrets: async () => [base],
    createSecret: async (input) => ({ ...base, ...input }),
    updateSecret: async () => undefined,
    deleteSecret: async () => undefined,
    findAgentByIdentifier: async () => null,
    getAgentSecrets: async () => [],
    setAgentSecrets: async () => undefined,
    setAgentSecretMode: async () => undefined,
  };
}

describe("createSecretsService", () => {
  it("create resolves successfully when the K8s mirror throws — best-effort contract", async () => {
    const k8sPort: K8sSecretsPort = {
      createSecret: async () => {
        throw new Error("simulated k8s API outage");
      },
      updateSecret: async () => undefined,
      deleteSecret: async () => undefined,
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const service = createSecretsService({ port: fakeOnecliPort(), k8sPort });

    const view = await service.create({
      name: "test-secret",
      type: "generic",
      value: "hunter2",
      hostPattern: "api.example.com",
      injectionConfig: { headerName: "Authorization", valueFormat: "Bearer {value}" },
    });

    expect(view.id).toBe("abc-123");
    // Failure is logged with the stable token + structured payload so log
    // scrapers can detect broken injection without parsing free-form text.
    expect(warn).toHaveBeenCalledWith(
      "[secrets-service] k8s-mirror-failed",
      expect.stringContaining('"op":"create"'),
    );
    const payload = warn.mock.calls[0][1] as string;
    expect(payload).toContain('"secretId":"abc-123"');
    expect(payload).toContain("simulated k8s API outage");

    warn.mockRestore();
  });

  it("update and delete equally tolerate K8s mirror failure", async () => {
    const k8sPort: K8sSecretsPort = {
      createSecret: async () => undefined,
      updateSecret: async () => {
        throw new Error("update boom");
      },
      deleteSecret: async () => {
        throw new Error("delete boom");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = createSecretsService({ port: fakeOnecliPort(), k8sPort });

    await expect(service.update({ id: "abc-123", value: "rotated" })).resolves.toBeUndefined();
    await expect(service.delete("abc-123")).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][1]).toContain('"op":"update"');
    expect(warn.mock.calls[1][1]).toContain('"op":"delete"');

    warn.mockRestore();
  });

  it("k8s mirror skipped entirely when k8sPort is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = createSecretsService({ port: fakeOnecliPort() });

    await service.create({
      name: "no-mirror",
      type: "generic",
      value: "hunter2",
      hostPattern: "api.example.com",
      injectionConfig: { headerName: "Authorization", valueFormat: "Bearer {value}" },
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
