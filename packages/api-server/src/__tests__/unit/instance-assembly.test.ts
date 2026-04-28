import { describe, it, expect } from "vitest";
import { assembleInstance, computeState, type InfraInstance } from "../../modules/agents/domain/instance-assembly.js";

function infra(overrides: Partial<InfraInstance> = {}): InfraInstance {
  return {
    id: "inst-1",
    name: "test",
    agentId: "agent-1",
    desiredState: "running",
    podReady: true,
    ...overrides,
  };
}

describe("computeState", () => {
  it("returns starting when currentState is running but pod not ready", () => {
    expect(computeState(infra({ currentState: "running", podReady: false }))).toBe("starting");
  });

  it("returns running when currentState is running and pod ready", () => {
    expect(computeState(infra({ currentState: "running", podReady: true }))).toBe("running");
  });
});

describe("assembleInstance — experimentalCredentialInjector round-trip", () => {
  it("threads the flag through to the assembled Instance", () => {
    const instance = assembleInstance(infra({ experimentalCredentialInjector: true }), [], []);
    expect(instance.experimentalCredentialInjector).toBe(true);
  });

  it("leaves the field undefined when not set on infra", () => {
    const instance = assembleInstance(infra(), [], []);
    expect(instance.experimentalCredentialInjector).toBeUndefined();
  });
});
