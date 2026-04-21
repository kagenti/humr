import { createHash } from "node:crypto";

export interface OnecliForeignCredentialsPort {
  exchangeImpersonationToken(foreignSub: string): Promise<string>;
  createOrFindAgent(args: {
    onecliToken: string;
    identifier: string;
    displayName: string;
  }): Promise<{ accessToken: string }>;
}

export interface OnecliForeignCredentialsConfig {
  keycloakTokenUrl: string;
  clientId: string;
  clientSecret: string;
  onecliAudience: string;
  onecliBaseUrl: string;
}

interface OnecliAgent {
  id: string;
  identifier: string;
  accessToken: string;
}

export function buildForkIdentifier(instanceId: string, foreignSub: string): string {
  const hash = createHash("sha256").update(foreignSub).digest("hex").slice(0, 12);
  return `fork-${instanceId}-${hash}`;
}

export function createOnecliForeignCredentialsPort(
  config: OnecliForeignCredentialsConfig,
): OnecliForeignCredentialsPort {
  async function postForm(
    url: string,
    params: URLSearchParams,
  ): Promise<{ access_token: string }> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Keycloak ${res.status}: ${body}`);
    }
    return res.json() as Promise<{ access_token: string }>;
  }

  async function getServiceAccountToken(): Promise<string> {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const data = await postForm(config.keycloakTokenUrl, params);
    return data.access_token;
  }

  async function exchangeImpersonationToken(foreignSub: string): Promise<string> {
    const saToken = await getServiceAccountToken();
    const params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      subject_token: saToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_subject: foreignSub,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: config.onecliAudience,
    });
    const data = await postForm(config.keycloakTokenUrl, params);
    return data.access_token;
  }

  async function onecliFetch(
    token: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    return fetch(`${config.onecliBaseUrl}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async function findAgentByIdentifier(
    token: string,
    identifier: string,
  ): Promise<OnecliAgent | null> {
    const res = await onecliFetch(token, "/api/agents");
    if (!res.ok) {
      throw new Error(`OneCLI GET /api/agents: ${res.status} ${await res.text()}`);
    }
    const list = (await res.json()) as OnecliAgent[];
    return list.find((a) => a.identifier === identifier) ?? null;
  }

  async function createOrFindAgent(args: {
    onecliToken: string;
    identifier: string;
    displayName: string;
  }): Promise<{ accessToken: string }> {
    const res = await onecliFetch(args.onecliToken, "/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: args.displayName, identifier: args.identifier }),
    });

    if (res.status === 409) {
      const existing = await findAgentByIdentifier(args.onecliToken, args.identifier);
      if (!existing) {
        throw new Error(`OneCLI 409 on create but no agent with identifier ${args.identifier}`);
      }
      return { accessToken: existing.accessToken };
    }

    if (!res.ok) {
      throw new Error(`OneCLI POST /api/agents: ${res.status} ${await res.text()}`);
    }

    const created = (await res.json()) as { id: string; accessToken?: string };
    if (created.accessToken) return { accessToken: created.accessToken };

    const full = await findAgentByIdentifier(args.onecliToken, args.identifier);
    if (!full) throw new Error(`OneCLI agent ${args.identifier} not found after create`);
    return { accessToken: full.accessToken };
  }

  return { exchangeImpersonationToken, createOrFindAgent };
}
