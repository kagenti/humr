import { Cron } from "croner";
import yaml from "js-yaml";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";
import { LABEL_AGENT_REF, SPEC_KEY, STATUS_KEY } from "./modules/agents/infrastructure/labels.js";
import { buildJob, type JobBuilderConfig } from "./modules/agents/infrastructure/job-builder.js";

interface ScheduleSpec {
  cron: string;
  task: string;
  type?: string;
  enabled: boolean;
  sessionMode?: string;
  mcpServers?: Record<string, unknown>;
}

export function createCronScheduler(k8s: K8sClient, jobCfg: JobBuilderConfig) {
  const jobs = new Map<string, Cron>();

  function sync(name: string, instanceId: string, specYaml: string) {
    remove(name);

    const spec = yaml.load(specYaml) as ScheduleSpec;
    if (!spec.enabled || !spec.cron) return;

    const job = new Cron(spec.cron, () => {
      fire(name, instanceId, spec).catch((err) => {
        process.stderr.write(`[cron] ${name} failed: ${err}\n`);
        writeStatus(name, err.message);
      });
    });

    jobs.set(name, job);
    process.stderr.write(`[cron] registered ${name} (${spec.cron})\n`);
  }

  function remove(name: string) {
    const existing = jobs.get(name);
    if (existing) {
      existing.stop();
      jobs.delete(name);
    }
  }

  async function fire(name: string, instanceId: string, spec: ScheduleSpec) {
    const instanceCM = await k8s.getConfigMap(instanceId);
    if (!instanceCM) throw new Error(`instance ${instanceId} not found`);

    const agentName = instanceCM.metadata?.labels?.[LABEL_AGENT_REF];
    if (!agentName) throw new Error(`instance ${instanceId} has no agent label`);

    const agentCM = await k8s.getConfigMap(agentName);
    if (!agentCM) throw new Error(`agent ${agentName} not found`);

    const triggerPayload = JSON.stringify({
      type: spec.type ?? "cron",
      task: spec.task,
      timestamp: new Date().toISOString(),
      schedule: name,
      ...(spec.sessionMode && { sessionMode: spec.sessionMode }),
      ...(spec.mcpServers && { mcpServers: spec.mcpServers }),
    });

    const job = buildJob({
      instanceName: instanceId,
      instanceCM,
      agentCM,
      cfg: jobCfg,
      extraEnv: [{ name: "HUMR_TRIGGER", value: triggerPayload }],
    });

    const created = await k8s.createJob(job);
    process.stderr.write(`[cron] ${name} → Job ${created.metadata!.name!}\n`);
    writeStatus(name, "success");
  }

  async function writeStatus(name: string, result: string) {
    try {
      await k8s.patchConfigMap(name, {
        data: { [STATUS_KEY]: yaml.dump({ version: "humr.ai/v1", lastRun: new Date().toISOString(), lastResult: result }) },
      });
    } catch { /* best effort */ }
  }

  function stop() {
    for (const [, j] of jobs) j.stop();
    jobs.clear();
  }

  return { sync, remove, stop };
}
