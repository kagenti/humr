import { type EnvVar, ChannelType } from "../shared.js";

export { ChannelType };

export interface Channel {
  type: ChannelType;
}

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  botToken: string;
}

export type ChannelConfig = SlackChannel;

export interface InstanceSpec {
  version: string;
  agentId: string;
  desiredState: "running" | "hibernated";
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  enabledMcpServers?: string[];
  channels?: ChannelConfig[];
}

export interface InstanceStatus {
  currentState: "running" | "hibernated" | "error";
  error?: string;
  podReady: boolean;
}

export interface Instance {
  id: string;
  name: string;
  spec: InstanceSpec;
  status?: InstanceStatus;
}

export interface CreateInstanceInput {
  name: string;
  agentId: string;
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  enabledMcpServers?: string[];
}

export interface UpdateInstanceInput {
  id: string;
  env?: EnvVar[];
  secretRef?: string;
  enabledMcpServers?: string[];
}

export interface InstancesService {
  list: () => Promise<Instance[]>;
  get: (id: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (id: string) => Promise<void>;
  wake: (id: string) => Promise<Instance | null>;
  connectSlack: (id: string, botToken: string) => Promise<Instance | null>;
  disconnectSlack: (id: string) => Promise<Instance | null>;
}
