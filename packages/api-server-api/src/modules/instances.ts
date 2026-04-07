import type { EnvVar } from "./templates.js";

export interface InstanceSpec {
  version: string;
  templateName: string;
  desiredState: "running" | "hibernated";
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
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
}

export interface UpdateInstanceInput {
  name: string;
  env?: EnvVar[];
  secretRef?: string;
}

export interface InstancesContext {
  list: () => Promise<Instance[]>;
  get: (name: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (name: string) => Promise<void>;
  wake: (name: string) => Promise<Instance | null>;
}
