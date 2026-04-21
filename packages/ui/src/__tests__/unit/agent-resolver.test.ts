import { describe, expect, test } from "vitest";
import { resolveAgentDisplay } from "../../components/agent-resolver.js";
import { transitionRestartingInstances } from "../../store/instances.js";
import type { AgentView, InstanceView } from "../../types.js";

const agent = (id: string): AgentView => ({
  id, name: id, templateId: null, image: "x:latest",
});

const inst = (id: string, agentId: string, state: InstanceView["state"]): InstanceView => ({
  id, name: id, agentId, state, channels: [], allowedUsers: [],
});

describe("resolveAgentDisplay", () => {
  test("returns no-instance when the agent has no instances", () => {
    const out = resolveAgentDisplay(agent("a"), [], new Set());
    expect(out).toEqual({ instance: null, state: "no-instance", clickable: false, canRestart: false });
  });

  test("picks the lowest-id instance when multiple exist", () => {
    const i1 = inst("i-002", "a", "running");
    const i2 = inst("i-001", "a", "error");
    const out = resolveAgentDisplay(agent("a"), [i1, i2], new Set());
    expect(out.instance?.id).toBe("i-001");
    expect(out.state).toBe("error");
  });

  test("ignores instances belonging to other agents", () => {
    const out = resolveAgentDisplay(
      agent("a"),
      [inst("i-1", "other", "running")],
      new Set(),
    );
    expect(out.state).toBe("no-instance");
  });

  test.each([
    ["running", true, true],
    ["error", false, true],
    ["starting", false, false],
    ["hibernating", false, false],
    ["hibernated", true, false],
  ] as const)("state=%s → clickable=%s canRestart=%s", (state, clickable, canRestart) => {
    const out = resolveAgentDisplay(
      agent("a"),
      [inst("i-1", "a", state)],
      new Set(),
    );
    expect(out.state).toBe(state);
    expect(out.clickable).toBe(clickable);
    expect(out.canRestart).toBe(canRestart);
  });

  test("restart override: state flips to restarting and actions are suppressed", () => {
    const i = inst("i-1", "a", "running");
    const out = resolveAgentDisplay(agent("a"), [i], new Set(["i-1"]));
    expect(out.state).toBe("restarting");
    expect(out.clickable).toBe(false);
    expect(out.canRestart).toBe(false);
  });

  test("restart override keyed on instance id, not agent id", () => {
    const out = resolveAgentDisplay(
      agent("a"),
      [inst("i-1", "a", "running")],
      new Set(["some-other-instance"]),
    );
    expect(out.state).toBe("running");
  });
});

describe("transitionRestartingInstances", () => {
  const entry = (seen: boolean) => ({ seenNonRunning: seen });

  test("keeps entry while state still reads running and no dip observed", () => {
    const current = new Map([["i-1", entry(false)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "running")]);
    expect(next.get("i-1")).toEqual(entry(false));
  });

  test("marks seenNonRunning once the pod goes to starting/error", () => {
    const current = new Map([["i-1", entry(false)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "starting")]);
    expect(next.get("i-1")).toEqual(entry(true));
  });

  test("clears entry once running returns after a non-running dip", () => {
    const current = new Map([["i-1", entry(true)]]);
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "running")]);
    expect(next.has("i-1")).toBe(false);
  });

  test("drops entry when the instance disappears", () => {
    const current = new Map([["i-1", entry(false)]]);
    const next = transitionRestartingInstances(current, []);
    expect(next.has("i-1")).toBe(false);
  });

  test("no-op when there are no restart entries", () => {
    const current = new Map<string, { seenNonRunning: boolean }>();
    const next = transitionRestartingInstances(current, [inst("i-1", "a", "running")]);
    expect(next).toBe(current);
  });
});
