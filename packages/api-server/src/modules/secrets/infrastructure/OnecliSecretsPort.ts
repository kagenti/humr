import type { OnecliClient } from "../../../onecli.js";

export interface OnecliSecret {
  id: string;
  name: string;
  type: string;
  hostPattern: string;
  createdAt: string;
  /** For type="anthropic", OneCLI stores { authMode: "api-key" | "oauth" }. */
  metadata?: { authMode?: "api-key" | "oauth" } | null;
}

export interface OnecliAgent {
  id: string;
  name: string;
  identifier: string;
  /** OneCLI secret-mode: "all" = all credentials, "selective" = explicit list. */
  secretMode: "all" | "selective";
}

export interface OnecliSecretsPort {
  listSecrets(): Promise<OnecliSecret[]>;
  createSecret(input: {
    name: string;
    type: string;
    value: string;
    hostPattern: string;
  }): Promise<OnecliSecret>;
  updateSecret(id: string, input: { name?: string; value?: string }): Promise<void>;
  deleteSecret(id: string): Promise<void>;
  findAgentByIdentifier(identifier: string): Promise<OnecliAgent | null>;
  getAgentSecrets(agentUuid: string): Promise<string[]>;
  setAgentSecrets(agentUuid: string, secretIds: string[]): Promise<void>;
  setAgentSecretMode(agentUuid: string, mode: "all" | "selective"): Promise<void>;
}

export function createOnecliSecretsPort(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
): OnecliSecretsPort {
  async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await oc.onecliFetch(userJwt, userSub, path, init);
    if (!res.ok) {
      const body = await res.text();
      const method = init?.method ?? "GET";
      throw new Error(`OneCLI ${method} ${path}: ${res.status} ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async function fetchVoid(path: string, init?: RequestInit): Promise<void> {
    const res = await oc.onecliFetch(userJwt, userSub, path, init);
    if (!res.ok) {
      const body = await res.text();
      const method = init?.method ?? "GET";
      throw new Error(`OneCLI ${method} ${path}: ${res.status} ${body}`);
    }
  }

  function extractIds(resp: unknown): string[] {
    // OneCLI may return several shapes depending on version; be defensive.
    if (Array.isArray(resp)) {
      return resp.map((item) =>
        typeof item === "string" ? item : (item as { id?: string })?.id ?? "",
      ).filter((s): s is string => s.length > 0);
    }
    if (resp && typeof resp === "object") {
      const r = resp as Record<string, unknown>;
      if (Array.isArray(r.secretIds)) {
        return (r.secretIds as unknown[]).filter((x): x is string => typeof x === "string");
      }
      if (Array.isArray(r.secrets)) {
        return (r.secrets as unknown[])
          .map((s) => (s as { id?: string })?.id ?? "")
          .filter((s): s is string => s.length > 0);
      }
    }
    return [];
  }

  return {
    listSecrets: () => fetchJson<OnecliSecret[]>("/api/secrets"),

    createSecret: (input) =>
      fetchJson<OnecliSecret>("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),

    updateSecret: (id, input) =>
      fetchVoid(`/api/secrets/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),

    deleteSecret: (id) =>
      fetchVoid(`/api/secrets/${encodeURIComponent(id)}`, { method: "DELETE" }),

    async findAgentByIdentifier(identifier) {
      const agents = await fetchJson<OnecliAgent[]>("/api/agents");
      const found = agents.find((a) => a.identifier === identifier);
      if (!found) return null;
      // Default to "selective" if the field is missing from the response.
      return { ...found, secretMode: found.secretMode ?? "selective" };
    },

    async getAgentSecrets(agentUuid) {
      const resp = await fetchJson<unknown>(
        `/api/agents/${encodeURIComponent(agentUuid)}/secrets`,
      );
      return extractIds(resp);
    },

    setAgentSecrets: (agentUuid, secretIds) =>
      fetchVoid(`/api/agents/${encodeURIComponent(agentUuid)}/secrets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secretIds }),
      }),

    setAgentSecretMode: (agentUuid, mode) =>
      fetchVoid(`/api/agents/${encodeURIComponent(agentUuid)}/secret-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }),
  };
}
