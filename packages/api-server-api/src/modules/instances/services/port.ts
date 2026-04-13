import type {
  Instance,
  CreateInstanceInput,
  UpdateInstanceInput,
} from "../domain/types.js";

export interface InstancesContext {
  list: () => Promise<Instance[]>;
  get: (name: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (name: string) => Promise<void>;
  wake: (name: string) => Promise<Instance | null>;
  connectSlack: (name: string, botToken: string) => Promise<Instance | null>;
  disconnectSlack: (name: string) => Promise<Instance | null>;
}
