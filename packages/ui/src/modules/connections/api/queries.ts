import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import { fetchMcpConnections } from "./fetchers.js";

export const mcpConnectionKeys = {
  all: ["mcp-connections"] as const,
  list: () => [...mcpConnectionKeys.all, "list"] as const,
};

export function useAppConnections(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.connections.list.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load app connections" },
  });
}

export function useMcpConnections(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mcpConnectionKeys.list(),
    queryFn: fetchMcpConnections,
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load MCP connections" },
  });
}
