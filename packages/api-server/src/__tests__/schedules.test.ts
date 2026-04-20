import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import { client } from "./helpers/trpc-client.js";

let AGENT_ID: string;
let INSTANCE_ID: string;

beforeAll(async () => {
  const agent = await client.agents.create.mutate({
    name: "test-agent",
    image: "alpine:latest",
    description: "test agent",
  });
  AGENT_ID = agent.id;
  const inst = await client.instances.create.mutate({
    name: "test-inst",
    agentId: AGENT_ID,
  });
  INSTANCE_ID = inst.id;
});

afterAll(async () => {
  const schedules = await client.schedules.list.query({
    instanceId: INSTANCE_ID,
  });
  for (const s of schedules) {
    try {
      await client.schedules.delete.mutate({ id: s.id });
    } catch {}
  }
  try {
    await client.instances.delete.mutate({ id: INSTANCE_ID });
  } catch {}
  try {
    await client.agents.delete.mutate({ id: AGENT_ID });
  } catch {}
});

let cronScheduleId: string;
let secondCronScheduleId: string;

describe("schedules: API server CRUD", () => {
  describe("create cron schedule", () => {
    it("returns correct fields", async () => {
      const result = await client.schedules.createCron.mutate({
        name: "daily-report",
        instanceId: INSTANCE_ID,
        cron: "0 9 * * *",
        task: "generate report",
      });

      cronScheduleId = result.id;
      expect(result.name).toBe("daily-report");
      expect(result.instanceId).toBe(INSTANCE_ID);
      expect(result.type).toBe("cron");
      expect(result.cron).toBe("0 9 * * *");
      expect(result.task).toBe("generate report");
      expect(result.enabled).toBe(true);
      expect(result.status).toBeNull();
    });

    it("rejects invalid cron expression", async () => {
      await expect(
        client.schedules.createCron.mutate({
          name: "bad-cron",
          instanceId: INSTANCE_ID,
          cron: "not-a-cron",
          task: "test",
        }),
      ).rejects.toThrow();
    });
  });

  describe("create second cron schedule", () => {
    it("returns correct fields", async () => {
      const result = await client.schedules.createCron.mutate({
        name: "health-check",
        instanceId: INSTANCE_ID,
        cron: "*/5 * * * *",
        task: "check health",
      });

      secondCronScheduleId = result.id;
      expect(result.name).toBe("health-check");
      expect(result.instanceId).toBe(INSTANCE_ID);
      expect(result.type).toBe("cron");
      expect(result.cron).toBe("*/5 * * * *");
      expect(result.enabled).toBe(true);
    });
  });

  describe("list schedules", () => {
    it("returns all schedules for the instance", async () => {
      const list = await client.schedules.list.query({
        instanceId: INSTANCE_ID,
      });

      expect(list).toHaveLength(2);
      const names = list.map((s) => s.name).sort();
      expect(names).toEqual(["daily-report", "health-check"]);
    });

    it("returns empty array for instance with no schedules", async () => {
      const list = await client.schedules.list.query({
        instanceId: "nonexistent",
      });
      expect(list).toEqual([]);
    });
  });

  describe("toggle enable/disable", () => {
    it("toggles enabled from true to false", async () => {
      const result = await client.schedules.toggle.mutate({
        id: cronScheduleId,
      });
      expect(result.enabled).toBe(false);
    });

    it("toggles back to true", async () => {
      const result = await client.schedules.toggle.mutate({
        id: cronScheduleId,
      });
      expect(result.enabled).toBe(true);
    });

    it("returns NOT_FOUND for non-existent schedule", async () => {
      try {
        await client.schedules.toggle.mutate({ id: "no-such-schedule" });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TRPCClientError);
        expect((e as TRPCClientError<AppRouter>).data?.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("delete schedule", () => {
    it("deletes the schedule", async () => {
      await client.schedules.delete.mutate({ id: cronScheduleId });

      const list = await client.schedules.list.query({
        instanceId: INSTANCE_ID,
      });
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("health-check");
    });

  });

  describe("read schedule status", () => {
    it("returns null status when cron has not fired", async () => {
      const sched = await client.schedules.get.query({
        id: secondCronScheduleId,
      });
      expect(sched.status).toBeNull();
    });

    it("returns NOT_FOUND for non-existent schedule", async () => {
      try {
        await client.schedules.get.query({ id: "no-such-schedule" });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TRPCClientError);
        expect((e as TRPCClientError<AppRouter>).data?.code).toBe("NOT_FOUND");
      }
    });
  });

});

// The controller-reconciliation e2e test was ConfigMap/status.yaml based.
// TODO: rewrite against the in-process cron-scheduler once the Job model
// stabilizes — needs to observe the DB-persisted lastRun/lastResult columns
// and a spawned agent Job instead of polling a ConfigMap.
