import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useAgents() {
  return useQuery({
    ...trpc.agents.list.queryOptions(),
    meta: { errorToast: "Couldn't load agents" },
  });
}

/**
 * Per-agent secret + connection access. The agent might not yet be registered
 * with OneCLI (controller syncs asynchronously after create), so we swallow
 * errors silently rather than toasting.
 */
export function useAgentAccess(agentId: string | null) {
  return useQuery({
    ...trpc.secrets.getAgentAccess.queryOptions(
      agentId ? { agentName: agentId } : undefined!,
    ),
    enabled: !!agentId,
    retry: false,
  });
}
