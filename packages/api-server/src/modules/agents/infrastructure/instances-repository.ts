import type { K8sClient } from "./k8s.js";
import {
  LABEL_TYPE, TYPE_INSTANCE, LABEL_OWNER, LABEL_INSTANCE_REF,
} from "./labels.js";
import {
  parseInfraInstance, isOwnedBy, hasType,
  buildInstanceConfigMap, patchSpecField, setDesiredState,
  isPodReady,
} from "./configmap-mappers.js";
import type { InfraInstance } from "../domain/instance-assembly.js";

export interface InstancesRepository {
  list(owner?: string): Promise<InfraInstance[]>;
  get(id: string, owner?: string): Promise<InfraInstance | null>;
  create(agentId: string, spec: Record<string, unknown>, owner: string): Promise<InfraInstance>;
  updateSpec(id: string, owner: string | undefined, patch: Record<string, unknown>): Promise<InfraInstance | null>;
  delete(id: string, owner?: string): Promise<boolean>;
  restart(id: string, owner?: string): Promise<boolean>;
  wake(id: string): Promise<InfraInstance | null>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  getOwner(id: string): Promise<string | null>;
  patchAnnotation(id: string, key: string, value: string): Promise<void>;
  wakeIfHibernated(id: string): Promise<boolean>;
  isPodReady(id: string): Promise<boolean>;
}

export function createInstancesRepository(k8s: K8sClient): InstancesRepository {
  return {
    async list(owner?) {
      const ownerSelector = owner ? `,${LABEL_OWNER}=${owner}` : "";
      const [configMaps, pods] = await Promise.all([
        k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_INSTANCE}${ownerSelector}`),
        k8s.listPods(LABEL_INSTANCE_REF),
      ]);
      const podMap = new Map<string, (typeof pods)[number]>();
      for (const pod of pods) {
        const ref = pod.metadata?.labels?.[LABEL_INSTANCE_REF];
        if (ref) podMap.set(ref, pod);
      }
      return configMaps.map((cm) =>
        parseInfraInstance(cm, podMap.get(cm.metadata!.name!)),
      );
    },

    async get(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      if (owner && !isOwnedBy(cm, owner)) return null;
      if (!owner && !hasType(cm, TYPE_INSTANCE)) return null;
      const pod = await k8s.getPod(`${id}-0`);
      return parseInfraInstance(cm, pod ?? undefined);
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

    async restart(id, owner?) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return false;
      if (owner && !isOwnedBy(cm, owner)) return false;
      // Delete pod-0; the StatefulSet controller will recreate it with the
      // current spec. For replicas=1 this is equivalent to `kubectl rollout
      // restart` without the pod-template annotation dance, which would be
      // wiped by the next reconcile of applyStatefulSet.
      // A 404 from deletePod (pod already gone — crashed, mid-recreate, etc.)
      // is still a successful restart from the user's perspective: the
      // StatefulSet will produce a fresh pod-0 regardless.
      await k8s.deletePod(`${id}-0`);
      return true;
    },

    async wake(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return null;
      const infra = parseInfraInstance(cm);
      if (infra.desiredState !== "hibernated") {
        const pod = await k8s.getPod(`${id}-0`);
        return parseInfraInstance(cm, pod ?? undefined);
      }
      const woken = setDesiredState(cm, "running");
      await k8s.replaceConfigMap(cm.metadata!.name!, woken);
      const reread = await k8s.getConfigMap(id);
      if (!reread) return null;
      const pod = await k8s.getPod(`${id}-0`);
      return parseInfraInstance(reread, pod ?? undefined);
    },

    async isOwnedBy(id, owner) {
      const cm = await k8s.getConfigMap(id);
      return cm !== null && isOwnedBy(cm, owner);
    },

    async getOwner(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm || !hasType(cm, TYPE_INSTANCE)) return null;
      return cm.metadata?.labels?.[LABEL_OWNER] ?? null;
    },

    async patchAnnotation(id, key, value) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return;
      if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
      cm.metadata!.annotations[key] = value;
      await k8s.replaceConfigMap(id, cm);
    },

    async wakeIfHibernated(id) {
      const cm = await k8s.getConfigMap(id);
      if (!cm) return false;
      const infra = parseInfraInstance(cm);
      if (infra.desiredState !== "hibernated") return true;
      const woken = setDesiredState(cm, "running");
      await k8s.replaceConfigMap(cm.metadata!.name!, woken);
      return true;
    },

    async isPodReady(id) {
      const pod = await k8s.getPod(`${id}-0`);
      return pod !== null && isPodReady(pod);
    },
  };
}
