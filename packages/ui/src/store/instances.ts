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
  /** Instance IDs whose pod has been deleted via Restart but hasn't yet cycled
   *  through a non-`running` state back to `running`. Each entry tracks whether
   *  we've observed the intermediate dip so we don't clear on the grace-period
   *  read that still shows `running` before the pod actually terminates, plus
   *  a click timestamp that bounds how long the "Restarting" pill can linger
   *  if the pod fails to recycle cleanly. */
  restartingInstances: Map<string, { seenNonRunning: boolean; clickedAt: number }>;
  fetchInstances: () => Promise<void>;
  createInstance: (agentId: string, name: string) => Promise<void>;
  restartInstance: (id: string) => Promise<void>;
  wakeInstance: (id: string) => Promise<void>;
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
  restartingInstances: new Map(),

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
        restartingInstances: transitionRestartingInstances(s.restartingInstances, result.list),
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

  wakeInstance: async (id) => {
    const ok = await runAction(
      () => platform.instances.wake.mutate({ id }),
      "Failed to start agent",
    );
    if (ok !== ACTION_FAILED) await get().fetchInstances();
  },

  restartInstance: async (id) => {
    set((s) => {
      const next = new Map(s.restartingInstances);
      next.set(id, { seenNonRunning: false, clickedAt: Date.now() });
      return { restartingInstances: next };
    });
    const ok = await runAction(
      () => platform.instances.restart.mutate({ id }),
      "Failed to restart agent",
    );
    if (ok === ACTION_FAILED) {
      set((s) => {
        const next = new Map(s.restartingInstances);
        next.delete(id);
        return { restartingInstances: next };
      });
      return;
    }
    await get().fetchInstances();
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

/** Upper bound on how long a single restart can keep the pill on "Restarting".
 *  A healthy pod roll for a single-replica StatefulSet takes <30s; anything
 *  past this ceiling means the pod failed to recycle and the user should see
 *  the underlying state so they can act. */
const RESTART_DISPLAY_TTL_MS = 120_000;

/**
 * Advances each restart entry based on the latest observed instance state:
 *   - instance gone → drop (instance was deleted mid-restart).
 *   - clickedAt older than RESTART_DISPLAY_TTL_MS → drop (stuck restart; let
 *     the real state surface).
 *   - state === "error" → drop (pod is observably not starting; user needs to
 *     see the error, not a stale "Restarting" pill).
 *   - state !== "running" → mark seenNonRunning (pod has cycled).
 *   - state === "running" && seenNonRunning → drop (restart complete).
 *   - state === "running" && !seenNonRunning → keep (still in grace window
 *     before the pod terminates; the poll that sees it down will flip it).
 * Exported for tests. Accepts `now` for deterministic testing.
 */
export function transitionRestartingInstances(
  current: Map<string, { seenNonRunning: boolean; clickedAt: number }>,
  instances: InstanceView[],
  now: number = Date.now(),
): Map<string, { seenNonRunning: boolean; clickedAt: number }> {
  if (current.size === 0) return current;
  const byId = new Map(instances.map((i) => [i.id, i]));
  const next = new Map<string, { seenNonRunning: boolean; clickedAt: number }>();
  for (const [id, entry] of current) {
    const inst = byId.get(id);
    if (!inst) continue;
    if (now - entry.clickedAt >= RESTART_DISPLAY_TTL_MS) continue;
    if (inst.state === "error") continue;
    if (inst.state !== "running") {
      next.set(id, { seenNonRunning: true, clickedAt: entry.clickedAt });
    } else if (!entry.seenNonRunning) {
      next.set(id, entry);
    }
  }
  return next;
}
