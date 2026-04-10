import type { EnvVar } from "./templates.js";

export interface InstanceSpec {
  version: string;
  agentId: string;
  desiredState: "running" | "hibernated";
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  enabledMcpServers?: string[];
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

export interface InstancesContext {
  list: () => Promise<Instance[]>;
  get: (id: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (id: string) => Promise<void>;
  wake: (id: string) => Promise<Instance | null>;
}
