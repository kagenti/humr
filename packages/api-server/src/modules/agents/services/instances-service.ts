import type {
  InstancesService,
  CreateInstanceInput,
  UpdateInstanceInput,
  ConnectTelegramInput,
  ConnectUnifiedInput,
  Agent,
} from "api-server-api";
import { SPEC_VERSION, ChannelType } from "api-server-api";
import type { InstancesRepository } from "./../infrastructure/instances-repository.js";
import { assembleInstance, findOrphanedInstanceIds } from "../domain/instance-assembly.js";
import { emit, EventType } from "../../../events.js";
import {
  toPublicChannel,
  type StoredChannelConfig,
  type StoredTelegramChannel,
  type StoredUnifiedChannel,
} from "../../channels/domain/stored-channel-config.js";

export function createInstancesService(deps: {
  repo: InstancesRepository;
  owner: string | undefined;
  getAgent: (id: string) => Promise<Agent | null>;
  listChannelsByOwner: () => Promise<Map<string, StoredChannelConfig[]>>;
  listChannelsByInstance: (instanceId: string) => Promise<StoredChannelConfig[]>;
  upsertChannel: (instanceId: string, channel: StoredChannelConfig) => Promise<void>;
  deleteChannelByType: (instanceId: string, type: ChannelType) => Promise<void>;
  deleteChannelsByInstanceIds: (instanceIds: string[]) => Promise<void>;
  listAllowedUsersByOwner: () => Promise<Map<string, string[]>>;
  listAllowedUsersByInstance: (instanceId: string) => Promise<string[]>;
  setAllowedUsers: (instanceId: string, subs: string[]) => Promise<void>;
  deleteAllowedUsersByInstanceIds: (instanceIds: string[]) => Promise<void>;
}): InstancesService {
  function publish(channels: StoredChannelConfig[]) {
    return channels.map(toPublicChannel);
  }

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
        assembleInstance(
          infra,
          publish(channelMap.get(infra.id) ?? []),
          allowedUsersMap.get(infra.id) ?? [],
        ),
      );
    },

    async get(id) {
      const [infra, channels, allowed] = await Promise.all([
        deps.repo.get(id, deps.owner),
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      if (!infra) return null;
      return assembleInstance(infra, publish(channels), allowed);
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
      const instance = assembleInstance(infra, publish(channels), allowed);

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
      const instance = assembleInstance(infra, publish(channels), allowed);

      if (infra.desiredState === "running") {
        emit({ type: EventType.InstanceWoken, instanceId: id });
      }
      return instance;
    },

    async connectSlack(id, slackChannelId) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.upsertChannel(id, { type: ChannelType.Slack, slackChannelId });
      emit({ type: EventType.SlackConnected, instanceId: id, slackChannelId });

      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      return assembleInstance(infra, publish(channels), allowed);
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
      return assembleInstance(infra, publish(channels), allowed);
    },

    async connectTelegram(id, input: ConnectTelegramInput) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      const stored: StoredTelegramChannel = {
        type: ChannelType.Telegram,
        telegramChatId: input.telegramChatId,
        botToken: input.botToken,
      };
      await deps.upsertChannel(id, stored);
      emit({ type: EventType.TelegramConnected, instanceId: id, telegramChatId: input.telegramChatId });

      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      return assembleInstance(infra, publish(channels), allowed);
    },

    async disconnectTelegram(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Telegram);
      emit({ type: EventType.TelegramDisconnected, instanceId: id });

      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      return assembleInstance(infra, publish(channels), allowed);
    },

    async connectUnified(id, input: ConnectUnifiedInput) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      const stored: StoredUnifiedChannel = {
        type: ChannelType.Unified,
        backend: input.backend,
        slackChannelId: input.slackChannelId,
        slackBotToken: input.slackBotToken,
        slackAppToken: input.slackAppToken,
        telegramChatId: input.telegramChatId,
        telegramBotToken: input.telegramBotToken,
      };
      await deps.upsertChannel(id, stored);
      emit({ type: EventType.UnifiedConnected, instanceId: id, backend: input.backend });

      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      return assembleInstance(infra, publish(channels), allowed);
    },

    async disconnectUnified(id) {
      const infra = await deps.repo.get(id, deps.owner);
      if (!infra) return null;

      await deps.deleteChannelByType(id, ChannelType.Unified);
      emit({ type: EventType.UnifiedDisconnected, instanceId: id });

      const [channels, allowed] = await Promise.all([
        deps.listChannelsByInstance(id),
        deps.listAllowedUsersByInstance(id),
      ]);
      return assembleInstance(infra, publish(channels), allowed);
    },

    async delete(id) {
      const deleted = await deps.repo.delete(id, deps.owner);
      if (deleted) {
        await deps.deleteAllowedUsersByInstanceIds([id]);
        emit({ type: EventType.InstanceDeleted, instanceId: id });
      }
    },
  };
}
