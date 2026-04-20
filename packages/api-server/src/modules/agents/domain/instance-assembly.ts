import type { Instance, InstanceState, ChannelConfig } from "api-server-api";

export interface InfraInstance {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  currentState?: string;
  error?: string;
}

export function computeState(infra: InfraInstance): InstanceState {
  if (infra.currentState === "error") return "error";
  // In the Job model, instances are always ready to accept work.
  // "Running" is transient (a Job exists) and not tracked at the instance level.
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
