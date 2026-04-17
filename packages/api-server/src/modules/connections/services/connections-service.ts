import type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "api-server-api";
import type { OnecliConnectionsPort } from "../infrastructure/onecli-connections-port.js";

function normalizeStatus(raw: string | null | undefined): AppConnectionStatus {
  if (!raw) return "connected";
  const v = raw.toLowerCase();
  if (v === "expired") return "expired";
  if (v === "disconnected" || v === "revoked") return "disconnected";
  return "connected";
}

function extractIdentity(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metadata) return undefined;
  // OneCLI stores the connected account's identifier under varied keys
  // depending on provider (email for Google, login for GitHub, etc.).
  for (const key of ["email", "login", "username", "handle", "name", "account"]) {
    const v = metadata[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function createConnectionsService(deps: {
  port: OnecliConnectionsPort;
}): ConnectionsService {
  return {
    async list() {
      const raw = await deps.port.listAppConnections();
      return raw.map<AppConnectionView>((c) => ({
        id: c.id,
        provider: c.provider,
        label: c.label && c.label.length > 0 ? c.label : c.provider,
        status: normalizeStatus(c.status),
        identity: extractIdentity(c.metadata),
        ...(c.scopes ? { scopes: c.scopes } : {}),
        ...(c.connectedAt ? { connectedAt: c.connectedAt } : {}),
      }));
    },

    async getAgentConnections(agentName: string): Promise<AgentAppConnections> {
      const agent = await deps.port.findAgentByIdentifier(agentName);
      if (!agent) {
        // Agent may not be registered in OneCLI yet (controller sync is async).
        return { connectionIds: [] };
      }
      const connectionIds = await deps.port.getAgentAppConnectionIds(agent.id);
      return { connectionIds };
    },
  };
}
