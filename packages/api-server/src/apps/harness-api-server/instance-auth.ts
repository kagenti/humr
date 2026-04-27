import { createHash } from "node:crypto";
import yaml from "js-yaml";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  LABEL_AGENT_REF,
  LABEL_OWNER,
  STATUS_KEY,
} from "../../modules/agents/infrastructure/labels.js";

/** Resolved instance metadata derived from a successful Bearer-token check. */
export interface InstanceIdentity {
  instanceId: string;
  agentName: string;
  owner: string;
}

/**
 * Verify a per-instance Bearer token against the agent ConfigMap's
 * `accessTokenHash` and return the resolved (agent, owner) identity.
 * Returns null on any auth or lookup failure — callers map that to 401/404.
 */
export async function verifyInstanceToken(
  k8s: K8sClient,
  instanceId: string,
  token: string,
): Promise<InstanceIdentity | null> {
  const instanceCm = await k8s.getConfigMap(instanceId);
  if (!instanceCm) return null;

  const agentName = instanceCm.metadata?.labels?.[LABEL_AGENT_REF];
  const owner = instanceCm.metadata?.labels?.[LABEL_OWNER];
  if (!agentName || !owner) return null;

  const agentCm = await k8s.getConfigMap(agentName);
  if (!agentCm) return null;
  if (agentCm.metadata?.labels?.[LABEL_OWNER] !== owner) return null;

  const statusYaml = agentCm.data?.[STATUS_KEY];
  if (!statusYaml) return null;
  const status = yaml.load(statusYaml) as { accessTokenHash?: string };
  if (!status?.accessTokenHash) return null;

  const hash = createHash("sha256").update(token).digest("hex");
  if (hash !== status.accessTokenHash) return null;

  return { instanceId, agentName, owner };
}
