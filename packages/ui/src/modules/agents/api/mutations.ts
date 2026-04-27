import { useMutation } from "@tanstack/react-query";

import { platform } from "../../../platform.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { EnvVar } from "../../../types.js";
import { instancesKeys } from "../../instances/api/queries.js";

const invalidatesAgentsAndInstances = {
  invalidates: [
    trpc.agents.list.queryKey(),
    instancesKeys.listWithChannels(),
  ],
};

export interface CreateAgentInput {
  name: string;
  templateId?: string;
  image?: string;
  description?: string;
  env?: EnvVar[];
  /** undefined ⇒ accept controller's default (auto-assign Anthropic selective).
   *  explicit array (incl. []) ⇒ override. */
  secretIds?: string[];
  appConnectionIds?: string[];
}

/**
 * Create-agent orchestrates four calls in sequence: create agent, create
 * instance, set agent access, set app connections. The trailing two run
 * against OneCLI which the controller registers asynchronously after agent
 * create — so they need a retry loop to ride out the sync lag.
 */
export function useCreateAgent() {
  return useMutation({
    mutationFn: async ({ secretIds, appConnectionIds, ...input }: CreateAgentInput) => {
      const agent = await platform.agents.create.mutate(input);
      await platform.instances.create.mutate({ name: input.name, agentId: agent.id });

      if (secretIds !== undefined) {
        await withRetry(() =>
          platform.secrets.setAgentAccess.mutate({
            agentName: agent.id,
            mode: "selective",
            secretIds,
          }),
        );
      }
      if (appConnectionIds?.length) {
        await withRetry(() =>
          platform.connections.setAgentConnections.mutate({
            agentName: agent.id,
            connectionIds: appConnectionIds,
          }),
        );
      }
      return agent;
    },
    meta: {
      ...invalidatesAgentsAndInstances,
      errorToast: "Failed to create agent",
    },
  });
}

export function useDeleteAgent() {
  return useMutation({
    ...trpc.agents.delete.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndInstances,
      errorToast: "Failed to delete agent",
    },
  });
}

export function useUpdateAgent() {
  return useMutation({
    ...trpc.agents.update.mutationOptions(),
    meta: {
      invalidates: [trpc.agents.list.queryKey()],
      errorToast: "Failed to update agent",
    },
  });
}

export function useSetAgentAccess() {
  return useMutation({
    ...trpc.secrets.setAgentAccess.mutationOptions(),
    meta: {
      invalidates: [trpc.secrets.getAgentAccess.queryKey()],
      errorToast: "Failed to update credential access",
    },
  });
}

export function useSetAgentConnections() {
  return useMutation({
    ...trpc.connections.setAgentConnections.mutationOptions(),
    meta: {
      invalidates: [trpc.connections.getAgentConnections.queryKey()],
      errorToast: "Failed to update app connections",
    },
  });
}

/**
 * Imperative fetch of per-agent access, used by consumers (e.g. MCP picker)
 * that need the data outside a component render.
 */
export async function fetchAgentAccess(agentId: string) {
  return queryClient.fetchQuery({
    ...trpc.secrets.getAgentAccess.queryOptions({ agentName: agentId }),
  });
}

async function withRetry(fn: () => Promise<void>, maxAttempts = 5, delayMs = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
