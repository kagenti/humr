import { describe, expect, it } from "vitest";
import {
  createGhEnterpriseBus,
  type GhEnterpriseEvent,
} from "../../modules/connections/services/gh-enterprise-bus.js";

describe("GhEnterpriseBus", () => {
  it("delivers events to subscribers of the matching agent", () => {
    const bus = createGhEnterpriseBus();
    const received: GhEnterpriseEvent[] = [];
    bus.subscribe("agent-a", (e) => received.push(e));
    bus.publish("agent-a", { kind: "upsert", connections: [{ host: "x" }] });
    expect(received).toEqual([{ kind: "upsert", connections: [{ host: "x" }] }]);
  });

  it("isolates topics across agents", () => {
    const bus = createGhEnterpriseBus();
    const recvA: GhEnterpriseEvent[] = [];
    const recvB: GhEnterpriseEvent[] = [];
    bus.subscribe("agent-a", (e) => recvA.push(e));
    bus.subscribe("agent-b", (e) => recvB.push(e));
    bus.publish("agent-a", { kind: "upsert", connections: [{ host: "a" }] });
    expect(recvA).toHaveLength(1);
    expect(recvB).toHaveLength(0);
  });

  it("supports multiple subscribers on the same agent", () => {
    const bus = createGhEnterpriseBus();
    const r1: GhEnterpriseEvent[] = [];
    const r2: GhEnterpriseEvent[] = [];
    bus.subscribe("agent-a", (e) => r1.push(e));
    bus.subscribe("agent-a", (e) => r2.push(e));
    bus.publish("agent-a", { kind: "upsert", connections: [] });
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("unsubscribe stops delivery", () => {
    const bus = createGhEnterpriseBus();
    const received: GhEnterpriseEvent[] = [];
    const unsub = bus.subscribe("agent-a", (e) => received.push(e));
    unsub();
    bus.publish("agent-a", { kind: "upsert", connections: [] });
    expect(received).toEqual([]);
  });

  it("publish without subscribers is a no-op", () => {
    const bus = createGhEnterpriseBus();
    expect(() =>
      bus.publish("nobody", { kind: "upsert", connections: [{ host: "x" }] }),
    ).not.toThrow();
  });

  it("isolates a throwing subscriber from the rest", () => {
    const bus = createGhEnterpriseBus();
    const okEvents: GhEnterpriseEvent[] = [];
    bus.subscribe("agent-a", () => {
      throw new Error("boom");
    });
    bus.subscribe("agent-a", (e) => okEvents.push(e));
    expect(() =>
      bus.publish("agent-a", { kind: "upsert", connections: [] }),
    ).not.toThrow();
    expect(okEvents).toHaveLength(1);
  });
});
