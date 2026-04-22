import type { StateCreator } from "zustand";
import { platform } from "../platform.js";
import type { SecretView, EnvMapping, InjectionConfig } from "../types.js";
import type { HumrStore } from "../store.js";
import { runAction, runQuery, ACTION_FAILED } from "./query-helpers.js";

export interface SecretsSlice {
  secrets: SecretView[];
  fetchSecrets: () => Promise<void>;
  createSecret: (input: {
    type: "anthropic" | "generic";
    name: string;
    value: string;
    hostPattern?: string;
    pathPattern?: string;
    injectionConfig?: InjectionConfig;
    envMappings?: EnvMapping[];
  }) => Promise<void>;
  updateSecret: (
    id: string,
    patch: {
      name?: string;
      value?: string;
      pathPattern?: string | null;
      injectionConfig?: InjectionConfig | null;
      envMappings?: EnvMapping[];
    },
  ) => Promise<void>;
  deleteSecret: (id: string) => Promise<void>;
}

export const createSecretsSlice: StateCreator<HumrStore, [], [], SecretsSlice> = (set, get) => ({
  secrets: [],

  fetchSecrets: async () => {
    const list = await runQuery("secrets", () => platform.secrets.list.query(), {
      fallback: "Couldn't load secrets",
    });
    set((s) => ({
      ...(list ? { secrets: list } : {}),
      loadedOnce: { ...s.loadedOnce, secrets: true },
    }));
  },

  createSecret: async (input) => {
    const ok = await runAction(
      () => platform.secrets.create.mutate(input),
      "Failed to create secret",
    );
    if (ok !== ACTION_FAILED) await get().fetchSecrets();
  },

  updateSecret: async (id, patch) => {
    const ok = await runAction(
      () => platform.secrets.update.mutate({ id, ...patch }),
      "Failed to update secret",
    );
    if (ok !== ACTION_FAILED) await get().fetchSecrets();
  },

  deleteSecret: async (id) => {
    const ok = await runAction(
      () => platform.secrets.delete.mutate({ id }),
      "Failed to delete secret",
    );
    if (ok !== ACTION_FAILED) await get().fetchSecrets();
  },
});
