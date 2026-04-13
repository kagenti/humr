import type {
  Instance,
  InstanceSpec,
  InstancesService,
  CreateInstanceInput,
  UpdateInstanceInput,
  ChannelConfig,
} from "api-server-api";
import { SPEC_VERSION, ChannelType } from "api-server-api";
import { emit } from "../../../events.js";
import type { SlackConnected } from "../domain/events/SlackConnected.js";
import type { SlackDisconnected } from "../domain/events/SlackDisconnected.js";

export function createInstancesService(deps: {
  list: () => Promise<Instance[]>;
  get: (id: string) => Promise<Instance | null>;
  create: (agentId: string, spec: Record<string, unknown>) => Promise<Instance>;
  update: (id: string, patch: { env?: unknown; secretRef?: unknown; enabledMcpServers?: unknown; channels?: unknown }) => Promise<Instance | null>;
  delete: (id: string) => Promise<boolean>;
  wake: (id: string) => Promise<Instance | null>;
  readSpec: (id: string) => Promise<InstanceSpec | null>;
  getAgent: (id: string) => Promise<{ id: string } | null>;
}): InstancesService {
  return {
    list: deps.list,
    get: deps.get,

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
      return deps.create(input.agentId, spec);
    },

    async update(input: UpdateInstanceInput) {
      return deps.update(input.id, {
        env: input.env,
        secretRef: input.secretRef,
        enabledMcpServers: input.enabledMcpServers,
      });
    },

    async wake(id) {
      return deps.wake(id);
    },

    async connectSlack(id, botToken) {
      const spec = await deps.readSpec(id);
      if (!spec) return null;

      const slackChannel = { type: ChannelType.Slack, botToken } as ChannelConfig;
      const channels = [...(spec.channels ?? []).filter(c => c.type !== ChannelType.Slack), slackChannel];
      const result = await deps.update(id, { channels });
      if (result) {
        emit({ type: "SlackConnected", instanceId: id, botToken } satisfies SlackConnected);
      }
      return result;
    },

    async disconnectSlack(id) {
      const spec = await deps.readSpec(id);
      if (!spec) return null;

      const channels = (spec.channels ?? []).filter(c => c.type !== ChannelType.Slack);
      const result = await deps.update(id, { channels });
      if (result) {
        emit({ type: "SlackDisconnected", instanceId: id } satisfies SlackDisconnected);
      }
      return result;
    },

    async delete(id) {
      emit({ type: "SlackDisconnected", instanceId: id } satisfies SlackDisconnected);
      await deps.delete(id);
    },
  };
}
