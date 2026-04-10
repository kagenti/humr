import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import { client } from "./helpers/trpc-client.js";
import {
  getConfigMap,
  configMapExists,
  patchConfigMapData,
  waitForConfigMapKey,
  waitForPodReady,
  dumpPodLogs,
  describePod,
  describeConfigMap,
  getEvents,
} from "./helpers/kubectl.js";
import yaml from "js-yaml";

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
let heartbeatScheduleId: string;

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

  describe("create heartbeat schedule", () => {
    it("returns correct fields with converted cron", async () => {
      const result = await client.schedules.createHeartbeat.mutate({
        name: "heartbeat",
        instanceId: INSTANCE_ID,
        intervalMinutes: 5,
      });

      heartbeatScheduleId = result.id;
      expect(result.name).toBe("heartbeat");
      expect(result.instanceId).toBe(INSTANCE_ID);
      expect(result.type).toBe("heartbeat");
      expect(result.cron).toBe("*/5 * * * *");
      expect(result.enabled).toBe(true);
    });

    it("converts 1-minute interval correctly", async () => {
      const result = await client.schedules.createHeartbeat.mutate({
        name: "every-minute",
        instanceId: INSTANCE_ID,
        intervalMinutes: 1,
      });

      expect(result.cron).toBe("* * * * *");

      await client.schedules.delete.mutate({ id: result.id });
    });

    it("rejects non-existent instance", async () => {
      await expect(
        client.schedules.createHeartbeat.mutate({
          name: "orphan",
          instanceId: "no-such-instance",
          intervalMinutes: 5,
        }),
      ).rejects.toThrow();
    });

    it("rejects zero interval", async () => {
      await expect(
        client.schedules.createHeartbeat.mutate({
          name: "zero",
          instanceId: INSTANCE_ID,
          intervalMinutes: 0,
        }),
      ).rejects.toThrow();
    });
  });

  describe("list schedules", () => {
    it("returns all schedules for the instance", async () => {
      const list = await client.schedules.list.query({
        instanceId: INSTANCE_ID,
      });

      expect(list).toHaveLength(2);
      const names = list.map((s) => s.name).sort();
      expect(names).toEqual(["daily-report", "heartbeat"]);
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
      expect(list[0].name).toBe("heartbeat");
    });

    it("ConfigMap is removed from cluster", async () => {
      expect(await configMapExists(cronScheduleId)).toBe(false);
    });
  });

  describe("read schedule status", () => {
    it("returns null status when controller has not written status.yaml", async () => {
      const sched = await client.schedules.get.query({
        id: heartbeatScheduleId,
      });
      expect(sched.status).toBeNull();
    });

    it("returns status fields after controller writes status.yaml", async () => {
      const statusYaml = [
        "lastRun: '2026-04-08T09:00:00Z'",
        "nextRun: '2026-04-08T09:05:00Z'",
        "lastResult: success",
      ].join("\n");
      await patchConfigMapData(
        heartbeatScheduleId,
        "status.yaml",
        statusYaml,
      );

      const sched = await client.schedules.get.query({
        id: heartbeatScheduleId,
      });
      expect(sched.status).toMatchObject({
        lastResult: "success",
      });
      expect(sched.status!.lastRun).toContain("2026-04-08T09:00:00");
      expect(sched.status!.nextRun).toContain("2026-04-08T09:05:00");
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

  describe("config", () => {
    it("returns default heartbeat interval", async () => {
      const config = await client.schedules.config.query();
      expect(config).toEqual({ defaultHeartbeatIntervalMinutes: 5 });
    });
  });
});

describe("e2e: controller reconciliation", () => {
  let e2eAgentId: string;
  let e2eInstanceId: string;
  let e2eScheduleId: string;

  beforeAll(async () => {
    // Use the default catalog template "code-guardian"
    const agent = await client.agents.create.mutate({
      name: "e2e-agent",
      templateId: "code-guardian",
    });
    e2eAgentId = agent.id;
    const inst = await client.instances.create.mutate({
      name: "e2e-instance",
      agentId: e2eAgentId,
    });
    e2eInstanceId = inst.id;
    await waitForPodReady(`${e2eInstanceId}-0`, 180_000);
  });

  afterAll(async () => {
    try {
      if (e2eScheduleId) await client.schedules.delete.mutate({ id: e2eScheduleId });
    } catch {}
    try {
      await client.instances.delete.mutate({ id: e2eInstanceId });
    } catch {}
    try {
      await client.agents.delete.mutate({ id: e2eAgentId });
    } catch {}
  });

  it("controller writes status.yaml after cron fires", async () => {
    const sched = await client.schedules.createCron.mutate({
      name: "e2e-cron",
      instanceId: e2eInstanceId,
      cron: "* * * * *",
      task: "e2e test task",
    });
    e2eScheduleId = sched.id;

    try {
      const cm = await waitForConfigMapKey(e2eScheduleId, "status.yaml");
      const status = yaml.load(cm.data!["status.yaml"]) as Record<
        string,
        unknown
      >;

      expect(status.lastResult).toBe("success");
      expect(status.lastRun).toBeTruthy();
      expect(status.nextRun).toBeTruthy();
    } catch (e) {
      const podName = `${e2eInstanceId}-0`;
      const [ctrlLogs, podInfo, podLogs, podEvents, scheduleCm] =
        await Promise.all([
          dumpPodLogs("app.kubernetes.io/component=controller"),
          describePod(podName),
          dumpPodLogs(`humr.ai/instance=${e2eInstanceId}`, "humr-agents"),
          getEvents(podName),
          describeConfigMap(e2eScheduleId),
        ]);
      console.error(
        [
          "=== Controller Logs ===",
          ctrlLogs,
          "=== Agent Pod Describe ===",
          podInfo,
          "=== Agent Pod Logs (incl. init) ===",
          podLogs,
          "=== Agent Pod Events ===",
          podEvents,
          "=== Schedule ConfigMap ===",
          scheduleCm,
        ].join("\n"),
      );
      throw e;
    }
  });
});
