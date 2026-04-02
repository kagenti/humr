import type { EnvVar } from "./templates.js";

export interface InstanceSpec {
  templateName: string;
  desiredState: "running" | "hibernated";
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
}

export interface Instance {
  name: string;
  spec: InstanceSpec;
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
