import type {
  InstancesService,
  CreateInstanceInput,
  UpdateInstanceInput,
  ChannelConfig,
  Agent,
} from "api-server-api";
import { SPEC_VERSION, ChannelType } from "api-server-api";
import type { InstancesRepository } from "../infrastructure/InstancesRepository.js";
import { assembleInstance, findOrphanedInstanceIds } from "../domain/instance-assembly.js";
import { emit, EventType } from "../../../events.js";

export function createInstancesService(deps: {
  repo: InstancesRepository;
  owner: string | undefined;
  getAgent: (id: string) => Promise<Agent | null>;
  listChannelsByOwner: () => Promise<Map<string, ChannelConfig[]>>;
  listChannelsByInstance: (instanceId: string) => Promise<ChannelConfig[]>;
  upsertChannel: (instanceId: string, channel: ChannelConfig) => Promise<void>;
  deleteChannelByType: (instanceId: string, type: ChannelType) => Promise<void>;
  deleteChannelsByInstanceIds: (instanceIds: string[]) => Promise<void>;
}): InstancesService {
  return {
    async list() {
      const [infraInstances, channelMap] = await Promise.all([
        deps.repo.list(deps.owner),
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
        deps.repo.get(id, deps.owner),
        deps.listChannelsByInstance(id),
      ]);
      if (!infra) return null;
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
      const infra = await deps.repo.create(input.agentId, spec, deps.owner ?? "");
      const instance = assembleInstance(infra, []);

      emit({ type: EventType.InstanceCreated, instanceId: instance.id, agentId: input.agentId });
      return instance;
    },

    async update(input: UpdateInstanceInput) {
      const infra = await deps.repo.updateSpec(input.id, deps.owner, {
        env: input.env,
        secretRef: input.secretRef,
        enabledMcpServers: input.enabledMcpServers,
      });
      if (!infra) return null;
      const channels = await deps.listChannelsByInstance(input.id);
      const instance = assembleInstance(infra, channels);

      emit({ type: EventType.InstanceUpdated, instanceId: input.id });
      return instance;
    },

    async wake(id) {
      const infra = await deps.repo.wake(id);
      if (!infra) return null;
      const channels = await deps.listChannelsByInstance(id);
      const instance = assembleInstance(infra, channels);

      if (infra.desiredState === "running") {
        emit({ type: EventType.InstanceWoken, instanceId: id });
      }
      return instance;
    },

    async connectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      const channel = { type: ChannelType.Slack, slackChannelId } as ChannelConfig;
      await deps.upsertChannel(id, channel);
      emit({ type: EventType.SlackConnected, instanceId: id, slackChannelId });

      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async disconnectSlack(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Slack);
      emit({ type: EventType.SlackDisconnected, instanceId: id });

      const channels = await deps.listChannelsByInstance(id);
      return assembleInstance(infra, channels);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (deleted) {
        emit({ type: EventType.InstanceDeleted, instanceId: id });
      }
    },
  };
}
