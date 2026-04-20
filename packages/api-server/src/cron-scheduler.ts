import { Cron } from "croner";
import { eq } from "drizzle-orm";
import type { Db } from "db";
import { schedules, instances, agents } from "db";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";
import { buildJob, type JobBuilderConfig, type AgentSpec } from "./modules/agents/infrastructure/job-builder.js";

interface ScheduleSpec {
  cron: string;
  task: string;
  type?: string;
  enabled: boolean;
  sessionMode?: string;
  mcpServers?: Record<string, unknown>;
}

export function createCronScheduler(k8s: K8sClient, jobCfg: JobBuilderConfig, db: Db) {
  const jobs = new Map<string, Cron>();

  function sync(id: string, instanceId: string, spec: ScheduleSpec) {
    remove(id);
    if (!spec.enabled || !spec.cron) return;

    const job = new Cron(spec.cron, () => {
      fire(id, instanceId, spec).catch((err) => {
        process.stderr.write(`[cron] ${id} failed: ${err}\n`);
      });
    });

    jobs.set(id, job);
    process.stderr.write(`[cron] registered ${id} (${spec.cron})\n`);
  }

  function remove(id: string) {
    const existing = jobs.get(id);
    if (existing) { existing.stop(); jobs.delete(id); }
  }

  async function fire(scheduleId: string, instanceId: string, spec: ScheduleSpec) {
    const [inst] = await db.select().from(instances).where(eq(instances.id, instanceId));
    if (!inst) throw new Error(`instance ${instanceId} not found`);

    const [agent] = await db.select().from(agents).where(eq(agents.id, inst.agentId));
    if (!agent) throw new Error(`agent ${inst.agentId} not found`);

    const triggerPayload = JSON.stringify({
      type: spec.type ?? "cron",
      task: spec.task,
      timestamp: new Date().toISOString(),
      schedule: scheduleId,
      ...(spec.sessionMode && { sessionMode: spec.sessionMode }),
      ...(spec.mcpServers && { mcpServers: spec.mcpServers }),
    });

    const job = buildJob({
      instanceId,
      agentId: agent.id,
      agentSpec: agent.spec as AgentSpec,
      cfg: jobCfg,
      extraEnv: [{ name: "HUMR_TRIGGER", value: triggerPayload }],
    });

    const created = await k8s.createJob(job);
    process.stderr.write(`[cron] ${scheduleId} → Job ${created.metadata!.name!}\n`);

    await db.update(schedules)
      .set({ lastRun: new Date(), lastResult: "success" })
      .where(eq(schedules.id, scheduleId));
  }

  async function syncAll() {
    const rows = await db.select().from(schedules);
    for (const row of rows) {
      sync(row.id, row.instanceId, row.spec as ScheduleSpec);
    }
  }

  function stop() {
    for (const [, j] of jobs) j.stop();
    jobs.clear();
  }

  return { sync, remove, syncAll, stop };
}
