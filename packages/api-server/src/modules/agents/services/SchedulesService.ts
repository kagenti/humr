import type {
  Schedule,
  SchedulesService,
  ScheduleSpec,
  CreateCronScheduleInput,
  CreateHeartbeatScheduleInput,
} from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import yaml from "js-yaml";
import type { K8sClient } from "../infrastructure/k8s.js";
import {
  LABEL_TYPE, TYPE_SCHEDULE, LABEL_OWNER, LABEL_INSTANCE_REF, LABEL_AGENT_REF,
  SPEC_KEY,
} from "../domain/labels.js";
import {
  parseSchedule, isOwnedBy,
  buildScheduleConfigMap,
} from "../domain/configmap-mappers.js";
import { validateCron, minutesToCron } from "../domain/cron.js";
import { DEFAULT_HEARTBEAT_INTERVAL_MINUTES } from "../domain/defaults.js";

export function createSchedulesService(deps: {
  k8s: K8sClient;
  owner: string;
}): SchedulesService {
  async function getOwned(id: string) {
    const cm = await deps.k8s.getConfigMap(id);
    if (!cm || !isOwnedBy(cm, deps.owner)) return null;
    return cm;
  }

  async function readAgentRef(instanceId: string): Promise<string | null> {
    const cm = await deps.k8s.getConfigMap(instanceId);
    if (!cm || !isOwnedBy(cm, deps.owner)) return null;
    return cm.metadata!.labels![LABEL_AGENT_REF] ?? null;
  }

  return {
    async list(instanceId) {
      const cms = await deps.k8s.listConfigMaps(
        `${LABEL_TYPE}=${TYPE_SCHEDULE},${LABEL_INSTANCE_REF}=${instanceId},${LABEL_OWNER}=${deps.owner}`,
      );
      return cms.map(parseSchedule);
    },

    async get(id) {
      const cm = await getOwned(id);
      if (!cm) return null;
      return parseSchedule(cm);
    },

    async createCron(input: CreateCronScheduleInput) {
      validateCron(input.cron);
      const agentRef = await readAgentRef(input.instanceId);
      if (!agentRef) throw new Error(`Instance "${input.instanceId}" not found`);

      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        type: "cron" as const,
        cron: input.cron,
        task: input.task,
        enabled: true,
      };
      const body = buildScheduleConfigMap(input.instanceId, agentRef, spec, deps.owner);
      const created = await deps.k8s.createConfigMap(body);
      return parseSchedule(created);
    },

    async createHeartbeat(input: CreateHeartbeatScheduleInput) {
      const agentRef = await readAgentRef(input.instanceId);
      if (!agentRef) throw new Error(`Instance "${input.instanceId}" not found`);

      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        type: "heartbeat" as const,
        cron: minutesToCron(input.intervalMinutes),
        task: "",
        enabled: true,
      };
      const body = buildScheduleConfigMap(input.instanceId, agentRef, spec, deps.owner);
      const created = await deps.k8s.createConfigMap(body);
      return parseSchedule(created);
    },

    async delete(id) {
      const cm = await getOwned(id);
      if (!cm) return;
      await deps.k8s.deleteConfigMap(id);
    },

    async toggle(id) {
      const cm = await getOwned(id);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
      spec.enabled = !spec.enabled;
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await deps.k8s.replaceConfigMap(id, cm);
      return parseSchedule(updated);
    },

    config() {
      return { defaultHeartbeatIntervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES };
    },
  };
}
