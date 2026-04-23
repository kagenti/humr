import type { AppConnectionView } from "api-server-api";
import type { StateCreator } from "zustand";

import { authFetch } from "../../auth.js";
import { platform } from "../../platform.js";
import type { HumrStore } from "../../store.js";
import { runQuery } from "../../store/query-helpers.js";
import type { McpConnection } from "../../types.js";

export interface ConnectionsSlice {
  // OneCLI app connections (Google, GitHub, Slack, …) and MCP server connections.
  // Shared across list/providers/connections views and the setup progress bar.
  appConnections: AppConnectionView[];
  appConnectionsError: string | null;
  mcpConnections: McpConnection[];
  fetchAppConnections: () => Promise<void>;
  fetchMcpConnections: () => Promise<void>;
}

export const createConnectionsSlice: StateCreator<HumrStore, [], [], ConnectionsSlice> = (set) => ({
  appConnections: [],
  appConnectionsError: null,
  mcpConnections: [],

  // App connections surface a banner in connections-view on failure, so capture
  // the error text on the store instead of only toasting.
  fetchAppConnections: async () => {
    try {
      const list = await platform.connections.list.query();
      set((s) => ({
        appConnections: Array.isArray(list) ? list : [],
        appConnectionsError: null,
        loadedOnce: { ...s.loadedOnce, appConnections: true },
      }));
    } catch (err) {
      set((s) => ({
        appConnectionsError: err instanceof Error ? err.message : String(err),
        loadedOnce: { ...s.loadedOnce, appConnections: true },
      }));
    }
  },

  fetchMcpConnections: async () => {
    const d = await runQuery(
      "mcp-connections",
      async () => (await authFetch("/api/mcp/connections")).json(),
      { fallback: "Couldn't load MCP connections" },
    );
    set((s) => ({
      ...(Array.isArray(d) ? { mcpConnections: d } : {}),
      loadedOnce: { ...s.loadedOnce, mcpConnections: true },
    }));
  },
});
