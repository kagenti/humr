import type {
  InstancesService,
  CreateInstanceInput,
  UpdateInstanceInput,
  ChannelConfig,
  Agent,
} from "api-server-api";
import { SPEC_VERSION, ChannelType } from "api-server-api";
import type { K8sClient } from "../infrastructure/k8s.js";
import {
  LABEL_TYPE, TYPE_INSTANCE, LABEL_OWNER, LABEL_INSTANCE_REF,
} from "../domain/labels.js";
import {
  parseInfraInstance, isOwnedBy, hasType, specYaml,
  buildInstanceConfigMap, patchSpecField, setDesiredState,
} from "../domain/configmap-mappers.js";
import { type InfraInstance, assembleInstance, findOrphanedInstanceIds } from "../domain/instance-assembly.js";
import { emit } from "../../../events.js";
import type { SlackConnected } from "../domain/events/SlackConnected.js";
import type { SlackDisconnected } from "../domain/events/SlackDisconnected.js";

export function createInstancesService(deps: {
  k8s: K8sClient;
  owner: string | undefined;
  getAgent: (id: string) => Promise<Agent | null>;
  listChannelsByOwner: () => Promise<Map<string, ChannelConfig[]>>;
  listChannelsByInstance: (instanceId: string) => Promise<ChannelConfig[]>;
  upsertChannel: (instanceId: string, channel: ChannelConfig) => Promise<void>;
  deleteChannelsByInstance: (instanceId: string) => Promise<void>;
  deleteChannelByType: (instanceId: string, type: ChannelType) => Promise<void>;
  allChannelInstanceIds: () => Promise<string[]>;
  deleteChannelsByInstanceIds: (instanceIds: string[]) => Promise<void>;
}): InstancesService {
  const ownerSelector = deps.owner ? `,${LABEL_OWNER}=${deps.owner}` : "";

  async function listInfra(): Promise<InfraInstance[]> {
    const [configMaps, pods] = await Promise.all([
      deps.k8s.listConfigMaps(`${LABEL_TYPE}=${TYPE_INSTANCE}${ownerSelector}`),
      deps.k8s.listPods(LABEL_INSTANCE_REF),
    ]);
    const podMap = new Map<string, (typeof pods)[number]>();
    for (const pod of pods) {
      const ref = pod.metadata?.labels?.[LABEL_INSTANCE_REF];
      if (ref) podMap.set(ref, pod);
    }
    return configMaps.map((cm) =>
      parseInfraInstance(cm, podMap.get(cm.metadata!.name!)),
    );
  }

  async function getInfra(id: string): Promise<InfraInstance | null> {
    const cm = await deps.k8s.getConfigMap(id);
    if (!cm) return null;
    if (deps.owner && !isOwnedBy(cm, deps.owner)) return null;
    if (!deps.owner && !hasType(cm, TYPE_INSTANCE)) return null;
    const pod = await deps.k8s.getPod(`${id}-0`);
    return parseInfraInstance(cm, pod ?? undefined);
  }

  return {
    async list() {
      const [infraInstances, channelMap] = await Promise.all([
        listInfra(),
        deps.listChannelsByOwner(),
      ]);

      const infraIds = new Set(infraInstances.map((i) => i.id));

      const psqlInstanceIds = [...channelMap.keys()];
      const orphans = findOrphanedInstanceIds(infraIds, psqlInstanceIds);
      if (orphans.length > 0) {
        await deps.deleteChannelsByInstanceIds(orphans);
        for (const id of orphans) channelMap.delete(id);
      }

      return infraInstances.map((infra) =>
        assembleInstance(infra, channelMap.get(infra.id) ?? []),
      );
    },

    async get(id) {
      const [infra, channels] = await Promise.all([
        getInfra(id),
        deps.listChannelsByInstance(id),
      ]);
      if (!infra) {
        if (channels.length > 0) {
          await deps.deleteChannelsByInstance(id);
        }
        return null;
      }
      return assembleInstance(infra, channels);
    },

    async create(input: CreateInstanceInput) {
      const agent = await deps.getAgent(input.agentId);
      if (!agent) throw new Error(`Agent "${input.agentId}" not found`);

      const spec = {
        name: input.name,
        version: SPEC_VERSION,
        agentId: input.agentId,
        desiredState: "running" as const,
        env: input.env,
        secretRef: input.secretRef,
        description: input.description,
        enabledMcpServers: input.enabledMcpServers,
      };
      const body = buildInstanceConfigMap(input.agentId, spec, deps.owner ?? "");
      const created = await deps.k8s.createConfigMap(body);
      return assembleInstance(parseInfraInstance(created), []);
    },

    async update(input: UpdateInstanceInput) {
      const cm = await deps.k8s.getConfigMap(input.id);
      if (!cm) return null;
      if (deps.owner && !isOwnedBy(cm, deps.owner)) return null;

      cm.data = patchSpecField(cm, {
        env: input.env,
        secretRef: input.secretRef,
        enabledMcpServers: input.enabledMcpServers,
      });
      const updated = await deps.k8s.replaceConfigMap(input.id, cm);
      const channels = await deps.listChannelsByInstance(input.id);
      return assembleInstance(parseInfraInstance(updated), channels);
    },

    async wake(id) {
      const cm = await deps.k8s.getConfigMap(id);
      if (!cm) return null;

      const raw = specYaml(cm) as { desiredState?: string } | null;
      if (raw?.desiredState !== "hibernated") {
        // Already running or starting — return current state
        const pod = await deps.k8s.getPod(`${id}-0`);
        const infra = parseInfraInstance(cm, pod ?? undefined);
        const channels = await deps.listChannelsByInstance(id);
        return assembleInstance(infra, channels);
      }

      const woken = setDesiredState(cm, "running");
      await deps.k8s.replaceConfigMap(cm.metadata!.name!, woken);
      const reread = await deps.k8s.getConfigMap(id);
      if (!reread) return null;
      const pod = await deps.k8s.getPod(`${id}-0`);
      const infra = parseInfraInstance(reread, pod ?? undefined);
      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async connectSlack(id, botToken) {
      const infra = await getInfra(id);
      if (!infra) return null;

      const channel = { type: ChannelType.Slack, botToken } as ChannelConfig;
      await deps.upsertChannel(id, channel);
      const connected: SlackConnected = { type: "SlackConnected", instanceId: id, botToken };
      emit(connected);

      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async disconnectSlack(id) {
      const infra = await getInfra(id);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Slack);
      const disconnected: SlackDisconnected = { type: "SlackDisconnected", instanceId: id };
      emit(disconnected);

      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async delete(id) {
      const disconnected: SlackDisconnected = { type: "SlackDisconnected", instanceId: id };
      emit(disconnected);
      const cm = await deps.k8s.getConfigMap(id);
      if (cm && (deps.owner ? isOwnedBy(cm, deps.owner) : true)) {
        await deps.k8s.deleteConfigMap(id);
        const pvcs = await deps.k8s.listPVCs(`${LABEL_INSTANCE_REF}=${id}`);
        await Promise.all(pvcs.map((pvc) => deps.k8s.deletePVC(pvc.metadata!.name!)));
      }
      await deps.deleteChannelsByInstance(id);
    },
  };
}
