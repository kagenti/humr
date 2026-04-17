import type { OnecliClient } from "../../../onecli.js";

/**
 * Row shape of OneCLI's `GET /api/connections` (>= onecli 0.0.12). Optional
 * fields are not narrowed — the service layer normalizes.
 */
export interface OnecliAppConnection {
  id: string;
  provider: string;
  label?: string | null;
  status?: string | null;
  scopes?: string[] | null;
  connectedAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OnecliAgent {
  id: string;
  identifier: string;
}

export interface OnecliConnectionsPort {
  listAppConnections(): Promise<OnecliAppConnection[]>;
  findAgentByIdentifier(identifier: string): Promise<OnecliAgent | null>;
  getAgentAppConnectionIds(agentUuid: string): Promise<string[]>;
}

export function createOnecliConnectionsPort(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
): OnecliConnectionsPort {
  async function fetchJson<T>(path: string): Promise<T> {
    const res = await oc.onecliFetch(userJwt, userSub, path);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OneCLI GET ${path}: ${res.status} ${body}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    async listAppConnections() {
      const data = await fetchJson<unknown>("/api/connections");
      if (!Array.isArray(data)) return [];
      return data as OnecliAppConnection[];
    },

    async findAgentByIdentifier(identifier) {
      const agents = await fetchJson<OnecliAgent[]>("/api/agents");
      return agents.find((a) => a.identifier === identifier) ?? null;
    },

    async getAgentAppConnectionIds(agentUuid) {
      const data = await fetchJson<unknown>(
        `/api/agents/${encodeURIComponent(agentUuid)}/connections`,
      );
      if (!Array.isArray(data)) return [];
      return (data as unknown[]).filter((x): x is string => typeof x === "string");
    },
  };
}
