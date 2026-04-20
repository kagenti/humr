import type { K8sClient } from "./k8s.js";
import type { OnecliClient } from "../../../onecli.js";

interface OnecliAgent {
  id: string;
  name: string;
  identifier: string;
  accessToken: string;
  secretMode: string;
}

export interface AgentProvisioner {
  provision(agentId: string, displayName: string, secretMode: string): Promise<void>;
  deprovision(agentId: string): Promise<void>;
}

export function createAgentProvisioner(
  k8s: K8sClient,
  onecli: OnecliClient,
  userJwt: string,
  userSub: string,
): AgentProvisioner {
  function tokenSecretName(agentId: string) {
    return `humr-agent-${agentId}-token`;
  }

  return {
    async provision(agentId, displayName, secretMode) {
      const secretName = tokenSecretName(agentId);
      const existing = await k8s.getSecret(secretName);
      if (existing) return; // already provisioned

      // Ensure the user exists in OneCLI. The sync saga runs async on authentication
      // and may not have completed when this request arrives — OneCLI returns 401
      // on user-scoped endpoints like /api/agents until sync has run.
      await onecli.syncUser(userJwt, userSub);

      // Register agent in OneCLI
      const createRes = await onecli.onecliFetch(userJwt, userSub, "/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: displayName, identifier: agentId }),
      });

      let agent: OnecliAgent;
      if (createRes.status === 409) {
        // Already exists — find it
        agent = await findByIdentifier(onecli, userJwt, userSub, agentId);
      } else if (createRes.ok) {
        const created = (await createRes.json()) as OnecliAgent;
        // Set secret mode
        await onecli.onecliFetch(userJwt, userSub, `/api/agents/${created.id}/secret-mode`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: secretMode }),
        });
        // POST response may not include accessToken — re-fetch
        agent = await findByIdentifier(onecli, userJwt, userSub, agentId);
      } else {
        const body = await createRes.text();
        throw new Error(`OneCLI agent registration failed: ${createRes.status} ${body}`);
      }

      // Create K8s Secret with access token
      await k8s.createSecret({
        metadata: {
          name: secretName,
          labels: { "humr.ai/type": "agent-token", "humr.ai/agent": agentId },
        },
        type: "Opaque",
        stringData: { "access-token": agent.accessToken },
      });
    },

    async deprovision(agentId) {
      // Delete from OneCLI
      try {
        const agent = await findByIdentifier(onecli, userJwt, userSub, agentId);
        await onecli.onecliFetch(userJwt, userSub, `/api/agents/${agent.id}`, { method: "DELETE" });
      } catch {
        // agent may not exist
      }
      // Secret is cleaned up by K8s cascade (owner ref) or explicitly
      try { await k8s.deleteSecret(tokenSecretName(agentId)); } catch { /* ignore */ }
    },
  };
}

async function findByIdentifier(
  onecli: OnecliClient,
  jwt: string,
  sub: string,
  identifier: string,
): Promise<OnecliAgent> {
  const res = await onecli.onecliFetch(jwt, sub, "/api/agents");
  if (!res.ok) throw new Error(`listing agents failed: ${res.status}`);
  const agents = (await res.json()) as OnecliAgent[];
  const found = agents.find((a) => a.identifier === identifier);
  if (!found) throw new Error(`agent ${identifier} not found in OneCLI`);
  return found;
}
