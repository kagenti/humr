import type { StateCreator } from "zustand";
import { platform } from "../platform.js";
import type { InstanceView } from "../types.js";
import type { HumrStore } from "../store.js";
import { viewToPath } from "./navigation.js";
import { runAction, runQuery, resetQueryTracker, ACTION_FAILED } from "./query-helpers.js";

export interface InstancesSlice {
  availableChannels: Record<string, boolean>;
  instances: InstanceView[];
  selectedInstance: string | null;
  fetchInstances: () => Promise<void>;
  createInstance: (agentId: string, name: string) => Promise<void>;
  deleteInstance: (id: string) => Promise<void>;
  updateInstance: (id: string, updates: { allowedUsers?: string[] }) => Promise<void>;
  connectSlack: (id: string, slackChannelId: string) => Promise<void>;
  disconnectSlack: (id: string) => Promise<void>;
  selectInstance: (id: string) => void;
  goBack: () => void;
}

export const createInstancesSlice: StateCreator<HumrStore, [], [], InstancesSlice> = (set, get) => ({
  availableChannels: {},
  instances: [],
  selectedInstance: null,

  fetchInstances: async () => {
    set((s) => ({ loading: { ...s.loading, instances: true } }));
    const result = await runQuery(
      "instances",
      async () => {
        const [list, availableChannels] = await Promise.all([
          platform.instances.list.query(),
          platform.channels.available.query(),
        ]);
        return { list, availableChannels };
      },
      { fallback: "Can't reach the server — instance list may be stale" },
    );
    if (result) {
      set((s) => ({
        instances: result.list,
        availableChannels: result.availableChannels,
        loadedOnce: { ...s.loadedOnce, instances: true },
      }));
    }
    set((s) => ({ loading: { ...s.loading, instances: false } }));
  },

  createInstance: async (agentId, name) => {
    const ok = await runAction(
      () => platform.instances.create.mutate({ name, agentId }),
      "Failed to create instance",
    );
    if (ok !== ACTION_FAILED) await get().fetchInstances();
  },

  deleteInstance: async (id) => {
    const ok = await runAction(
      () => platform.instances.delete.mutate({ id }),
      "Failed to delete instance",
    );
    if (ok !== ACTION_FAILED) await get().fetchInstances();
  },

  updateInstance: async (id, updates) => {
    const ok = await runAction(
      () => platform.instances.update.mutate({ id, ...updates }),
      "Failed to update instance",
    );
    if (ok !== ACTION_FAILED) await get().fetchInstances();
  },

  connectSlack: async (id, slackChannelId) => {
    const ok = await runAction(
      () => platform.instances.connectSlack.mutate({ id, slackChannelId }),
      "Failed to connect Slack",
    );
    if (ok !== ACTION_FAILED) await get().fetchInstances();
  },

  disconnectSlack: async (id) => {
    const ok = await runAction(
      () => platform.instances.disconnectSlack.mutate({ id }),
      "Failed to disconnect Slack",
    );
    if (ok !== ACTION_FAILED) await get().fetchInstances();
  },

  selectInstance: (id) => {
    const prev = get().selectedInstance;
    history.pushState(null, "", viewToPath("chat", id));
    get().resetChatContext();
    // Clear per-instance poll tracker state so a prior instance's failure count
    // doesn't bleed into this one.
    if (prev && prev !== id) {
      resetQueryTracker(`sessions:${prev}`);
      resetQueryTracker(`schedules:${prev}`);
    }
    set({ selectedInstance: id, view: "chat", mobileScreen: "sessions", showMobilePanel: false });
  },

  goBack: () => {
    const prev = get().selectedInstance;
    history.pushState(null, "", "/");
    get().resetChatContext();
    if (prev) {
      resetQueryTracker(`sessions:${prev}`);
      resetQueryTracker(`schedules:${prev}`);
    }
    set({ selectedInstance: null, view: "list", showMobilePanel: false });
    get().fetchAgents();
    get().fetchInstances();
  },
});
