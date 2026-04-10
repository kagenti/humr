import type { EnvVar } from "./templates.js";

export interface SlackConfig {
  botToken: string;
  appToken: string;
}

export interface InstanceSpec {
  version: string;
  templateName: string;
  desiredState: "running" | "hibernated";
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  enabledMcpServers?: string[];
  slackConfig?: SlackConfig;
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

export interface SlackBotManager {
  start(instanceName: string, botToken: string, appToken: string): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
}

export interface InstancesContext {
  list: () => Promise<Instance[]>;
  get: (name: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (name: string) => Promise<void>;
  wake: (name: string) => Promise<Instance | null>;
  connectSlack: (name: string, botToken: string, appToken: string) => Promise<Instance | null>;
  disconnectSlack: (name: string) => Promise<Instance | null>;
}
