import type { StateCreator } from "zustand";
import { platform } from "../platform.js";
import type { AgentView, SecretMode, EnvVar } from "../types.js";
import type { HumrStore } from "../store.js";
import { runAction, runQuery, ACTION_FAILED } from "./query-helpers.js";

export interface AgentsSlice {
  agents: AgentView[];
  agentAccess: Record<string, { mode: SecretMode; secretIds: string[] }>;
  fetchAgents: () => Promise<void>;
  fetchAgentAccess: (agentId: string) => Promise<void>;
  createAgent: (input: {
    name: string;
    templateId?: string;
    image?: string;
    description?: string;
    secretMode?: "all" | "selective";
    secretIds?: string[];
    appConnectionIds?: string[];
    autoCreateInstance?: boolean;
  }) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  updateAgent: (id: string, patch: { description?: string; env?: EnvVar[] }) => Promise<void>;
}

export const createAgentsSlice: StateCreator<HumrStore, [], [], AgentsSlice> = (set, get) => ({
  agents: [],
  agentAccess: {},

  fetchAgents: async () => {
    set((s) => ({ loading: { ...s.loading, agents: true } }));
    const list = await runQuery("agents", () => platform.agents.list.query(), {
      fallback: "Couldn't load agents",
    });
    if (list) set((s) => ({ agents: list, loadedOnce: { ...s.loadedOnce, agents: true } }));
    set((s) => ({ loading: { ...s.loading, agents: false } }));
  },

  fetchAgentAccess: async (agentId) => {
    // Agent might not be registered in OneCLI yet — silently skip.
    try {
      const access = await platform.secrets.getAgentAccess.query({ agentName: agentId });
      set((s) => ({ agentAccess: { ...s.agentAccess, [agentId]: access } }));
    } catch {}
  },

  createAgent: async ({ secretMode, secretIds, appConnectionIds, autoCreateInstance, ...input }) => {
    const agent = await runAction(
      () => platform.agents.create.mutate(input),
      "Failed to create agent",
    );
    if (agent === ACTION_FAILED) return;
    await get().fetchAgents();

    if (autoCreateInstance) {
      await runAction(async () => {
        await platform.instances.create.mutate({ name: input.name, agentId: agent.id });
        await get().fetchInstances();
      }, "Agent created but failed to create instance");
    }

    // Only call setAgentAccess if the user deviates from the controller's default
    // ("selective" + auto-assigned anthropic) — i.e. selective with an explicit
    // list, or all-credentials mode.
    const needsAccessUpdate =
      secretMode === "all" || (secretMode === "selective" && secretIds?.length);
    // Controller registers the OneCLI agent asynchronously, so both
    // setAgentAccess and setAgentConnections have to retry past the sync lag.
    const withRetry = async (label: string, fn: () => Promise<void>) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await fn(); return; }
        catch (err: unknown) {
          if (attempt === 4) {
            const msg = err instanceof Error && err.message
              ? err.message
              : `Agent created but ${label} failed`;
            get().showToast({ kind: "error", message: msg });
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };
    if (needsAccessUpdate) {
      await withRetry("secret assignment", () =>
        platform.secrets.setAgentAccess.mutate({
          agentName: agent.id,
          mode: secretMode ?? "selective",
          secretIds: secretIds ?? [],
        }),
      );
    }
    if (appConnectionIds?.length) {
      await withRetry("app assignment", () =>
        platform.connections.setAgentConnections.mutate({
          agentName: agent.id,
          connectionIds: appConnectionIds,
        }),
      );
    }
  },

  deleteAgent: async (id) => {
    const ok = await runAction(
      () => platform.agents.delete.mutate({ id }),
      "Failed to delete agent",
    );
    if (ok === ACTION_FAILED) return;
    await get().fetchAgents();
    await get().fetchInstances();
  },

  updateAgent: async (id, patch) => {
    const ok = await runAction(
      () => platform.agents.update.mutate({ id, ...patch }),
      "Failed to update agent",
    );
    if (ok !== ACTION_FAILED) await get().fetchAgents();
  },
});
