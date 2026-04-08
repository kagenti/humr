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
} from "./helpers/kubectl.js";
import yaml from "js-yaml";

const TEMPLATE_NAME = "test-tmpl";
const INSTANCE_NAME = "test-inst";

beforeAll(async () => {
  await client.templates.create.mutate({
    name: TEMPLATE_NAME,
    image: "alpine:latest",
    description: "test template",
  });
  await client.instances.create.mutate({
    name: INSTANCE_NAME,
    templateName: TEMPLATE_NAME,
  });
});

afterAll(async () => {
  const schedules = await client.schedules.list.query({
    instanceName: INSTANCE_NAME,
  });
  for (const s of schedules) {
    try {
      await client.schedules.delete.mutate({ name: s.name });
    } catch {}
  }
  try {
    await client.instances.delete.mutate({ name: INSTANCE_NAME });
  } catch {}
  try {
    await client.templates.delete.mutate({ name: TEMPLATE_NAME });
  } catch {}
});

describe("schedules: API server CRUD", () => {
  describe("create cron schedule", () => {
    it("returns correct fields", async () => {
      const result = await client.schedules.createCron.mutate({
        name: "daily-report",
        instanceName: INSTANCE_NAME,
        cron: "0 9 * * *",
        task: "generate report",
      });

      expect(result).toEqual({
        name: `${INSTANCE_NAME}-daily-report`,
        instanceName: INSTANCE_NAME,
        type: "cron",
        cron: "0 9 * * *",
        task: "generate report",
        enabled: true,
        status: null,
      });
    });

    it("created the ConfigMap with correct labels", async () => {
      const cm = await getConfigMap(`${INSTANCE_NAME}-daily-report`);
      const labels = cm.metadata!.labels!;
      expect(labels["humr.ai/type"]).toBe("agent-schedule");
      expect(labels["humr.ai/instance"]).toBe(INSTANCE_NAME);
      expect(labels["humr.ai/template"]).toBe(TEMPLATE_NAME);
    });

    it("stored correct spec.yaml", async () => {
      const cm = await getConfigMap(`${INSTANCE_NAME}-daily-report`);
      const spec = yaml.load(cm.data!["spec.yaml"]) as Record<string, unknown>;
      expect(spec.type).toBe("cron");
      expect(spec.cron).toBe("0 9 * * *");
      expect(spec.task).toBe("generate report");
      expect(spec.enabled).toBe(true);
    });

    it("rejects invalid cron expression", async () => {
      await expect(
        client.schedules.createCron.mutate({
          name: "bad-cron",
          instanceName: INSTANCE_NAME,
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
        instanceName: INSTANCE_NAME,
        intervalMinutes: 5,
      });

      expect(result).toEqual({
        name: `${INSTANCE_NAME}-heartbeat`,
        instanceName: INSTANCE_NAME,
        type: "heartbeat",
        cron: "*/5 * * * *",
        task: "",
        enabled: true,
        status: null,
      });
    });

    it("converts 1-minute interval correctly", async () => {
      const result = await client.schedules.createHeartbeat.mutate({
        name: "every-minute",
        instanceName: INSTANCE_NAME,
        intervalMinutes: 1,
      });

      expect(result.cron).toBe("* * * * *");

      await client.schedules.delete.mutate({
        name: `${INSTANCE_NAME}-every-minute`,
      });
    });

    it("rejects non-existent instance", async () => {
      await expect(
        client.schedules.createHeartbeat.mutate({
          name: "orphan",
          instanceName: "no-such-instance",
          intervalMinutes: 5,
        }),
      ).rejects.toThrow();
    });

    it("rejects zero interval", async () => {
      await expect(
        client.schedules.createHeartbeat.mutate({
          name: "zero",
          instanceName: INSTANCE_NAME,
          intervalMinutes: 0,
        }),
      ).rejects.toThrow();
    });
  });

  describe("list schedules", () => {
    it("returns all schedules for the instance", async () => {
      const list = await client.schedules.list.query({
        instanceName: INSTANCE_NAME,
      });

      expect(list).toHaveLength(2);
      const names = list.map((s) => s.name).sort();
      expect(names).toEqual([
        `${INSTANCE_NAME}-daily-report`,
        `${INSTANCE_NAME}-heartbeat`,
      ]);
    });

    it("returns empty array for instance with no schedules", async () => {
      const list = await client.schedules.list.query({
        instanceName: "nonexistent",
      });
      expect(list).toEqual([]);
    });
  });

  describe("toggle enable/disable", () => {
    it("toggles enabled from true to false", async () => {
      const result = await client.schedules.toggle.mutate({
        name: `${INSTANCE_NAME}-daily-report`,
      });
      expect(result.enabled).toBe(false);
    });

    it("persisted the toggle in the ConfigMap", async () => {
      const cm = await getConfigMap(`${INSTANCE_NAME}-daily-report`);
      const spec = yaml.load(cm.data!["spec.yaml"]) as Record<string, unknown>;
      expect(spec.enabled).toBe(false);
    });

    it("toggles back to true", async () => {
      const result = await client.schedules.toggle.mutate({
        name: `${INSTANCE_NAME}-daily-report`,
      });
      expect(result.enabled).toBe(true);
    });

    it("returns NOT_FOUND for non-existent schedule", async () => {
      try {
        await client.schedules.toggle.mutate({ name: "no-such-schedule" });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(TRPCClientError);
        expect((e as TRPCClientError<AppRouter>).data?.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("delete schedule", () => {
    it("deletes the schedule", async () => {
      await client.schedules.delete.mutate({
        name: `${INSTANCE_NAME}-daily-report`,
      });

      const list = await client.schedules.list.query({
        instanceName: INSTANCE_NAME,
      });
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe(`${INSTANCE_NAME}-heartbeat`);
    });

    it("ConfigMap is removed from cluster", async () => {
      expect(await configMapExists(`${INSTANCE_NAME}-daily-report`)).toBe(
        false,
      );
    });
  });

  describe("read schedule status", () => {
    it("returns null status when controller has not written status.yaml", async () => {
      const sched = await client.schedules.get.query({
        name: `${INSTANCE_NAME}-heartbeat`,
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
        `${INSTANCE_NAME}-heartbeat`,
        "status.yaml",
        statusYaml,
      );

      const sched = await client.schedules.get.query({
        name: `${INSTANCE_NAME}-heartbeat`,
      });
      expect(sched.status).toMatchObject({
        lastResult: "success",
      });
      expect(sched.status!.lastRun).toContain("2026-04-08T09:00:00");
      expect(sched.status!.nextRun).toContain("2026-04-08T09:05:00");
    });

    it("returns NOT_FOUND for non-existent schedule", async () => {
      try {
        await client.schedules.get.query({ name: "no-such-schedule" });
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

  describe("input validation", () => {
    it("rejects uppercase in schedule name", async () => {
      await expect(
        client.schedules.createCron.mutate({
          name: "BadName",
          instanceName: INSTANCE_NAME,
          cron: "* * * * *",
          task: "test",
        }),
      ).rejects.toThrow();
    });

    it("rejects empty schedule name", async () => {
      await expect(
        client.schedules.createCron.mutate({
          name: "",
          instanceName: INSTANCE_NAME,
          cron: "* * * * *",
          task: "test",
        }),
      ).rejects.toThrow();
    });
  });
});

describe("e2e: controller reconciliation", () => {
  const E2E_INSTANCE = "e2e-agent";
  const SCHEDULE_NAME = "e2e-cron";
  const CM_NAME = `${E2E_INSTANCE}-${SCHEDULE_NAME}`;

  beforeAll(async () => {
    await client.instances.create.mutate({
      name: E2E_INSTANCE,
      templateName: "code-guardian",
    });
    await waitForPodReady(`${E2E_INSTANCE}-0`, 180_000);
  });

  afterAll(async () => {
    try {
      await client.schedules.delete.mutate({ name: CM_NAME });
    } catch {}
    try {
      await client.instances.delete.mutate({ name: E2E_INSTANCE });
    } catch {}
  });

  // skip: controller informer stalls after OneCLI registration — pod never created (#34)
  it.skip("controller writes status.yaml after cron fires", async () => {
    await client.schedules.createCron.mutate({
      name: SCHEDULE_NAME,
      instanceName: E2E_INSTANCE,
      cron: "* * * * *",
      task: "e2e test task",
    });

    const cm = await waitForConfigMapKey(CM_NAME, "status.yaml");
    const status = yaml.load(cm.data!["status.yaml"]) as Record<
      string,
      unknown
    >;

    expect(status.lastResult).toBe("success");
    expect(status.lastRun).toBeTruthy();
    expect(status.nextRun).toBeTruthy();
  });
});
