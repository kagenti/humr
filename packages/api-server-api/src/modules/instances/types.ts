import { type EnvVar, ChannelType } from "../shared.js";

export { ChannelType };

export interface Channel {
  type: ChannelType;
}

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  slackChannelId: string;
}

export type ChannelConfig = SlackChannel;

export type InstanceState = "idle" | "starting" | "running" | "hibernating" | "hibernated" | "error";

export interface Instance {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  state: InstanceState;
  error?: string;
  channels: ChannelConfig[];
  allowedUsers: string[];
}

export interface CreateInstanceInput {
  name: string;
  agentId: string;
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  allowedUsers?: string[];
}

export interface UpdateInstanceInput {
  id: string;
  env?: EnvVar[];
  secretRef?: string;
  allowedUsers?: string[];
}

export interface InstancesService {
  list: () => Promise<Instance[]>;
  get: (id: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (id: string) => Promise<void>;
  wake: (id: string) => Promise<Instance | null>;
  connectSlack: (id: string, slackChannelId: string) => Promise<Instance | null>;
  disconnectSlack: (id: string) => Promise<Instance | null>;
}
