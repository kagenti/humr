import type { Instance, InstanceState, ChannelConfig } from "api-server-api";

export interface InfraInstance {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  desiredState: "running" | "hibernated";
  currentState?: "running" | "hibernated" | "error";
  error?: string;
  podReady: boolean;
}

export function computeState(infra: InfraInstance): InstanceState {
  if (infra.currentState === "error") return "error";
  if (infra.desiredState === "running" && infra.currentState !== "running") return "starting";
  if (infra.desiredState === "hibernated" && infra.currentState === "running") return "hibernating";
  if (infra.desiredState === "hibernated") return "hibernated";
  return "running";
}

export function assembleInstance(
  infra: InfraInstance,
  channels: ChannelConfig[],
  allowedUsers: string[] = [],
): Instance {
  return {
    id: infra.id,
    name: infra.name,
    agentId: infra.agentId,
    description: infra.description,
    state: computeState(infra),
    error: infra.currentState === "error" ? infra.error : undefined,
    channels,
    allowedUsers,
  };
}

export function findOrphanedInstanceIds(
  infraIds: Set<string>,
  psqlInstanceIds: string[],
): string[] {
  return psqlInstanceIds.filter((id) => !infraIds.has(id));
}
