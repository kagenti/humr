import type { OnecliClient } from "../../../onecli.js";

/**
 * Shape returned by OneCLI's `GET /api/connections`. Fields beyond `id` and
 * `provider` are treated as optional — we normalize in the service layer.
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

export interface OnecliConnectionsPort {
  listAppConnections(): Promise<OnecliAppConnection[]>;
}

export function createOnecliConnectionsPort(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
): OnecliConnectionsPort {
  return {
    async listAppConnections() {
      const res = await oc.onecliFetch(userJwt, userSub, "/api/connections");
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OneCLI GET /api/connections: ${res.status} ${body}`);
      }
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return [];
      return data as OnecliAppConnection[];
    },
  };
}
