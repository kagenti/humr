import { skipToken, useQuery } from "@tanstack/react-query";

import { platform } from "../../../platform.js";

export const egressRulesKeys = {
  all: ["egress-rules"] as const,
  forAgent: (agentId: string | null) => [...egressRulesKeys.all, "agent", agentId] as const,
};

export function useEgressRulesForAgent(agentId: string | null) {
  return useQuery({
    queryKey: egressRulesKeys.forAgent(agentId),
    queryFn: agentId
      ? () => platform.egressRules.listForAgent.query({ agentId })
      : skipToken,
    meta: { errorToast: "Couldn't load egress rules" },
  });
}
