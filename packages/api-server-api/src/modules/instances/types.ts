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
  templateName: string;
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
  name: string;
  spec: InstanceSpec;
  status?: InstanceStatus;
}

export interface CreateInstanceInput {
  name: string;
  templateName: string;
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  enabledMcpServers?: string[];
}

export interface UpdateInstanceInput {
  name: string;
  env?: EnvVar[];
  secretRef?: string;
  enabledMcpServers?: string[];
}

export interface InstancesService {
  list: () => Promise<Instance[]>;
  get: (name: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (name: string) => Promise<void>;
  wake: (name: string) => Promise<Instance | null>;
  connectSlack: (name: string, botToken: string) => Promise<Instance | null>;
  disconnectSlack: (name: string) => Promise<Instance | null>;
}
