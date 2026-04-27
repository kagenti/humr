import type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "api-server-api";
import type { OnecliConnectionsPort } from "../infrastructure/onecli-connections-port.js";
import type { GhEnterpriseBus } from "./gh-enterprise-bus.js";
import { toGhEnterpriseHosts } from "./gh-enterprise-snapshot.js";

export function normalizeStatus(
  raw: string | null | undefined,
): AppConnectionStatus {
  if (!raw) return "connected";
  const v = raw.toLowerCase();
  if (v === "connected") return "connected";
  if (v === "expired") return "expired";
  if (v === "disconnected" || v === "revoked") return "disconnected";
  // Unrecognized status: don't show a green "Connected" badge on a state we
  // can't vouch for (e.g. a future "pending" or "syncing" OneCLI status).
  return "unknown";
}

/**
 * Keys are tried in this order because:
 *   - `email`: most providers' canonical user identifier (Google, Microsoft)
 *   - `login`/`username`/`handle`: GitHub / GitLab / Slack-style handles
 *   - `name`: display name (less precise; last resort before `account`)
 *   - `account`: generic fallback some providers use
 */
export function extractIdentity(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metadata) return undefined;
  for (const key of ["email", "login", "username", "handle", "name", "account"]) {
    const v = metadata[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function createConnectionsService(deps: {
  port: OnecliConnectionsPort;
  /**
   * Optional bus for publishing github-enterprise hosts.yml updates to
   * agent pod sidecars. Omit in tests or when SSE delivery isn't wired.
   */
  ghEnterpriseBus?: GhEnterpriseBus;
}): ConnectionsService {
  return {
    async list() {
      // OneCLI returns `providerName` and `envMappings` joined from the app
      // registry — provider-specific knowledge lives there, not here.
      const raw = await deps.port.listAppConnections();
      return raw
        .filter((c) => typeof c.id === "string" && typeof c.provider === "string")
        .map<AppConnectionView>((c) => ({
          id: c.id,
          provider: c.provider,
          label: c.providerName?.trim() || c.label?.trim() || c.provider,
          status: normalizeStatus(c.status),
          identity: extractIdentity(c.metadata) || c.label?.trim() || undefined,
          ...(c.scopes ? { scopes: c.scopes } : {}),
          ...(c.connectedAt ? { connectedAt: c.connectedAt } : {}),
          ...(c.envMappings && c.envMappings.length > 0
            ? { envMappings: c.envMappings }
            : {}),
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

    async setAgentConnections(agentName: string, connectionIds: string[]) {
      const agent = await deps.port.findAgentByIdentifier(agentName);
      // Write path fails loud when the agent isn't synced to OneCLI yet:
      // a silent no-op would confuse users who just checked a box.
      if (!agent) throw new Error(`Agent "${agentName}" not found in OneCLI`);
      const deduped = Array.from(new Set(connectionIds));
      await deps.port.setAgentAppConnectionIds(agent.id, deduped);

      // Push the github-enterprise subset to subscribed pod sidecars so
      // `gh auth status` reflects the change without rolling the pod.
      // Spec: never delete; the sidecar's "fill-if-missing" merge handles
      // re-grants idempotently, so we send the full current granted set
      // rather than computing a diff. Revokes intentionally emit nothing —
      // old hosts linger in hosts.yml until manually edited.
      const bus = deps.ghEnterpriseBus;
      if (bus) {
        const granted = new Set(deduped);
        const all = await deps.port.listAppConnections();
        const ghe = toGhEnterpriseHosts(
          all
            .filter((c) => c.provider === "github-enterprise" && granted.has(c.id))
            .map((c) => ({ id: c.id, provider: c.provider, metadata: c.metadata })),
        );
        if (ghe.length > 0) {
          bus.publish(agentName, { kind: "upsert", connections: ghe });
        }
      }
    },
  };
}
