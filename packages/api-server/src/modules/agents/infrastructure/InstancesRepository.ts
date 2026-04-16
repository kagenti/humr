import type { K8sClient } from "./k8s.js";
import {
  LABEL_TYPE, TYPE_INSTANCE, LABEL_OWNER, LABEL_INSTANCE_REF,
} from "./labels.js";
import {
  parseInfraInstance, isOwnedBy, hasType,
  buildInstanceConfigMap, patchSpecField,
} from "./configmap-mappers.js";
import type { InfraInstance } from "../domain/instance-assembly.js";

export interface InstancesRepository {
  list(owner?: string): Promise<InfraInstance[]>;
  get(id: string, owner?: string): Promise<InfraInstance | null>;
  create(agentId: string, spec: Record<string, unknown>, owner: string): Promise<InfraInstance>;
  updateSpec(id: string, owner: string | undefined, patch: Record<string, unknown>): Promise<InfraInstance | null>;
  delete(id: string, owner?: string): Promise<boolean>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
}

export function createInstancesRepository(k8s: K8sClient): InstancesRepository {
  return {
    async list(owner?) {
      const ownerSelector = owner ? `,${LABEL_OWNER}=${owner}` : "";
      const configMaps = await k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_INSTANCE}${ownerSelector}`);
      return configMaps.map((cm) => parseInfraInstance(cm));
    },

    async get(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      if (owner && !isOwnedBy(cm, owner)) return null;
      if (!owner && !hasType(cm, TYPE_INSTANCE)) return null;
      return parseInfraInstance(cm);
    },

    async create(agentId, spec, owner) {
      const body = buildInstanceConfigMap(agentId, spec, owner);
      const created = await k8s.createConfigMap(body);
      return parseInfraInstance(created);
    },

    async updateSpec(id, owner, patch) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      if (owner && !isOwnedBy(cm, owner)) return null;
      cm.data = patchSpecField(cm, patch);
      const updated = await k8s.replaceConfigMap(id, cm);
      return parseInfraInstance(updated);
    },

    async delete(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return false;
      if (owner && !isOwnedBy(cm, owner)) return false;
      await k8s.deleteConfigMap(id);
      return true;
    },

    async isOwnedBy(id, owner) {
      const cm = await k8s.getConfigMap(id);
      return cm !== null && isOwnedBy(cm, owner);
    },
  };
}
