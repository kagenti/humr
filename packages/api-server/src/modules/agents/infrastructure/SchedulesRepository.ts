import type { Schedule, ScheduleSpec, ImprovementState } from "api-server-api";
import yaml from "js-yaml";
import type { K8sClient } from "./k8s.js";
import {
  LABEL_TYPE, TYPE_SCHEDULE, LABEL_OWNER, LABEL_INSTANCE_REF,
  LABEL_AGENT_REF, SPEC_KEY,
} from "./labels.js";
import {
  parseSchedule, isOwnedBy, buildScheduleConfigMap,
} from "./configmap-mappers.js";

export interface SchedulesRepository {
  list(instanceId: string, owner: string): Promise<Schedule[]>;
  get(id: string, owner: string): Promise<Schedule | null>;
  create(instanceId: string, agentRef: string, spec: Record<string, unknown>, owner: string): Promise<Schedule>;
  delete(id: string, owner: string): Promise<void>;
  toggle(id: string, owner: string): Promise<Schedule | null>;
  readAgentRef(instanceId: string, owner: string): Promise<string | null>;
  getImprovementState(instanceId: string): Promise<ImprovementState>;
}

export function createSchedulesRepository(k8s: K8sClient): SchedulesRepository {
  async function getOwned(id: string, owner: string) {
    const cm = await k8s.getConfigMap(id);
    if (!cm || !isOwnedBy(cm, owner)) return null;
    return cm;
  }

  return {
    async list(instanceId, owner) {
      const cms = await k8s.listConfigMaps(
        `${LABEL_TYPE}=${TYPE_SCHEDULE},${LABEL_INSTANCE_REF}=${instanceId},${LABEL_OWNER}=${owner}`,
      );
      return cms.map(parseSchedule);
    },

    async get(id, owner) {
      const cm = await getOwned(id, owner);
      if (!cm) return null;
      return parseSchedule(cm);
    },

    async create(instanceId, agentRef, spec, owner) {
      const body = buildScheduleConfigMap(instanceId, agentRef, spec, owner);
      const created = await k8s.createConfigMap(body);
      return parseSchedule(created);
    },

    async delete(id, owner) {
      const cm = await getOwned(id, owner);
      if (!cm) return;
      await k8s.deleteConfigMap(id);
    },

    async toggle(id, owner) {
      const cm = await getOwned(id, owner);
      if (!cm) return null;
      const spec = yaml.load(cm.data?.[SPEC_KEY] ?? "") as ScheduleSpec;
      spec.enabled = !spec.enabled;
      cm.data = { ...cm.data, [SPEC_KEY]: yaml.dump(spec) };
      const updated = await k8s.replaceConfigMap(id, cm);
      return parseSchedule(updated);
    },

    async readAgentRef(instanceId, owner) {
      const cm = await getOwned(instanceId, owner);
      if (!cm) return null;
      return cm.metadata!.labels![LABEL_AGENT_REF] ?? null;
    },

    async getImprovementState(instanceId) {
      const url = `http://${k8s.podUrl(instanceId)}/api/trpc/improvement.status`;
      try {
        const res = await fetch(url);
        if (!res.ok) return { state: "idle" };
        const body = (await res.json()) as {
          result?: { data?: { running: boolean; last: { state: string; finishedAt: string; detail?: string } | null } };
        };
        const data = body.result?.data;
        if (!data) return { state: "idle" };
        if (data.running) return { state: "running" };
        if (data.last) {
          return {
            state: data.last.state as ImprovementState["state"],
            finishedAt: data.last.finishedAt,
            detail: data.last.detail,
          };
        }
        return { state: "idle" };
      } catch {
        return { state: "idle" };
      }
    },
  };
}
