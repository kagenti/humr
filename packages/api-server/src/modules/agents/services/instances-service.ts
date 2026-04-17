import type {
  InstancesService,
  CreateInstanceInput,
  UpdateInstanceInput,
  ChannelConfig,
  Agent,
} from "api-server-api";
import { SPEC_VERSION, ChannelType } from "api-server-api";
import type { InstancesRepository } from "./../infrastructure/instances-repository.js";
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
  listAllowedUsersByOwner: () => Promise<Map<string, string[]>>;
  listAllowedUsersByInstance: (instanceId: string) => Promise<string[]>;
  setAllowedUsers: (instanceId: string, subs: string[]) => Promise<void>;
  deleteAllowedUsersByInstanceIds: (instanceIds: string[]) => Promise<void>;
}): InstancesService {
  return {
    async list() {
      const [infraInstances, channelMap, allowedUsersMap] = await Promise.all([
        deps.repo.list(deps.owner),
        deps.listChannelsByOwner(),
        deps.listAllowedUsersByOwner(),
      ]);

      const infraIds = new Set(infraInstances.map((i) => i.id));
      const psqlInstanceIds = [...new Set([...channelMap.keys(), ...allowedUsersMap.keys()])];
      const orphans = findOrphanedInstanceIds(infraIds, psqlInstanceIds);
      if (orphans.length > 0) {
        await Promise.all([
          deps.deleteChannelsByInstanceIds(orphans),
          deps.deleteAllowedUsersByInstanceIds(orphans),
        ]);
        for (const id of orphans) {
          channelMap.delete(id);
          allowedUsersMap.delete(id);
        }
      }

      return infraInstances.map((infra) =>
        assembleInstance(infra, channelMap.get(infra.id) ?? [], allowedUsersMap.get(infra.id) ?? []),
      );
    },

    async get(id) {
      const [infra, channels, allowed] = await Promise.all([
        deps.repo.get(id, deps.owner),
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      if (!infra) return null;
      return assembleInstance(infra, channels, allowed);
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
      };
      const infra = await deps.repo.create(input.agentId, spec, deps.owner ?? "");
      if (input.allowedUsers && input.allowedUsers.length > 0) {
        await deps.setAllowedUsers(infra.id, input.allowedUsers);
      }
      const instance = assembleInstance(infra, [], input.allowedUsers ?? []);

      emit({ type: EventType.InstanceCreated, instanceId: instance.id, agentId: input.agentId });
      return instance;
    },

    async update(input: UpdateInstanceInput) {
      const infra = await deps.repo.updateSpec(input.id, deps.owner, {
        env: input.env,
        secretRef: input.secretRef,
      });
      if (!infra) return null;
      if (input.allowedUsers !== undefined) {
        await deps.setAllowedUsers(input.id, input.allowedUsers);
      }
      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(input.id),
        deps.listAllowedUsersByInstance(input.id),
      ]);
      const instance = assembleInstance(infra, channels, allowed);

      emit({ type: EventType.InstanceUpdated, instanceId: input.id });
      return instance;
    },

    async wake(id) {
      if (deps.owner && !await deps.repo.isOwnedBy(id, deps.owner)) return null;
      const infra = await deps.repo.wake(id);
      if (!infra) return null;
      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      const instance = assembleInstance(infra, channels, allowed);

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

      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      return assembleInstance(infra, channels, allowed);
    },

    async disconnectSlack(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Slack);
      emit({ type: EventType.SlackDisconnected, instanceId: id });

      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      return assembleInstance(infra, channels, allowed);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (deleted) {
        await Promise.all([
          deps.deleteChannelsByInstanceIds([id]),
          deps.deleteAllowedUsersByInstanceIds([id]),
        ]);
        emit({ type: EventType.InstanceDeleted, instanceId: id });
      }
    },
  };
}
