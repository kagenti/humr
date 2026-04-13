import type {
  InstancesService,
  CreateInstanceInput,
  UpdateInstanceInput,
  ChannelConfig,
} from "api-server-api";
import { SPEC_VERSION, ChannelType } from "api-server-api";
import { emit } from "../../../events.js";
import type { SlackConnected } from "../domain/events/SlackConnected.js";
import type { SlackDisconnected } from "../domain/events/SlackDisconnected.js";
import { type InfraInstance, assembleInstance, findOrphanedInstanceIds } from "../domain/instance-assembly.js";

export function createInstancesService(deps: {
  list: () => Promise<InfraInstance[]>;
  get: (id: string) => Promise<InfraInstance | null>;
  create: (agentId: string, spec: Record<string, unknown>) => Promise<InfraInstance>;
  update: (id: string, patch: { env?: unknown; secretRef?: unknown; enabledMcpServers?: unknown }) => Promise<InfraInstance | null>;
  delete: (id: string) => Promise<boolean>;
  wake: (id: string) => Promise<InfraInstance | null>;
  getAgent: (id: string) => Promise<{ id: string } | null>;
  listChannelsByOwner: () => Promise<Map<string, ChannelConfig[]>>;
  listChannelsByInstance: (instanceId: string) => Promise<ChannelConfig[]>;
  upsertChannel: (instanceId: string, channel: ChannelConfig) => Promise<void>;
  deleteChannelsByInstance: (instanceId: string) => Promise<void>;
  deleteChannelByType: (instanceId: string, type: ChannelType) => Promise<void>;
  allChannelInstanceIds: () => Promise<string[]>;
  deleteChannelsByInstanceIds: (instanceIds: string[]) => Promise<void>;
}): InstancesService {
  return {
    async list() {
      const [infraInstances, channelMap] = await Promise.all([
        deps.list(),
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
        deps.get(id),
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
      const infra = await deps.create(input.agentId, spec);
      return assembleInstance(infra, []);
    },

    async update(input: UpdateInstanceInput) {
      const infra = await deps.update(input.id, {
        env: input.env,
        secretRef: input.secretRef,
        enabledMcpServers: input.enabledMcpServers,
      });
      if (!infra) return null;
      const channels = await deps.listChannelsByInstance(input.id);
      return assembleInstance(infra, channels);
    },

    async wake(id) {
      const infra = await deps.wake(id);
      if (!infra) return null;
      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async connectSlack(id, botToken) {
      const infra = await deps.get(id);
      if (!infra) return null;

      const channel = { type: ChannelType.Slack, botToken } as ChannelConfig;
      await deps.upsertChannel(id, channel);
      emit({ type: "SlackConnected", instanceId: id, botToken } satisfies SlackConnected);

      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async disconnectSlack(id) {
      const infra = await deps.get(id);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Slack);
      emit({ type: "SlackDisconnected", instanceId: id } satisfies SlackDisconnected);

      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async delete(id) {
      emit({ type: "SlackDisconnected", instanceId: id } satisfies SlackDisconnected);
      await Promise.all([
        deps.delete(id),
        deps.deleteChannelsByInstance(id),
      ]);
    },
  };
}
