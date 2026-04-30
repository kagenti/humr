import { z } from "zod";

import { authFetch } from "../../../auth.js";

const mcpConnectionSchema = z.object({
  hostname: z.string(),
  connectedAt: z.string(),
  expired: z.boolean(),
});

const mcpConnectionsSchema = z.array(mcpConnectionSchema);

export async function fetchMcpConnections(): Promise<z.infer<typeof mcpConnectionsSchema>> {
  const res = await authFetch("/api/mcp/connections");
  if (!res.ok) throw new Error(`Couldn't load MCP connections (${res.status})`);
  return mcpConnectionsSchema.parse(await res.json());
}

const startOAuthResponseSchema = z.object({
  authUrl: z.string().optional(),
  error: z.string().optional(),
});

export async function startMcpOAuth(mcpServerUrl: string) {
  const res = await authFetch("/api/oauth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mcpServerUrl }),
  });
  if (!res.ok) throw new Error(`OAuth start failed (${res.status})`);
  return startOAuthResponseSchema.parse(await res.json());
}

export async function disconnectMcp(hostname: string): Promise<void> {
  const res = await authFetch(
    `/api/mcp/connections/${encodeURIComponent(hostname)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
}

// ---------------------------------------------------------------------------
// Named OAuth apps (GitHub, GitHub Enterprise)
// ---------------------------------------------------------------------------

const oauthAppSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  hostPattern: z.string(),
});
const oauthAppsSchema = z.array(oauthAppSummarySchema);
export type OAuthAppSummary = z.infer<typeof oauthAppSummarySchema>;

const oauthAppConnectionSchema = z.object({
  appId: z.string(),
  displayName: z.string(),
  hostPattern: z.string(),
  connectedAt: z.string(),
  expired: z.boolean(),
});
const oauthAppConnectionsSchema = z.array(oauthAppConnectionSchema);
export type OAuthAppConnection = z.infer<typeof oauthAppConnectionSchema>;

export async function fetchOAuthApps(): Promise<OAuthAppSummary[]> {
  const res = await authFetch("/api/oauth/apps");
  if (!res.ok) throw new Error(`Couldn't load OAuth apps (${res.status})`);
  return oauthAppsSchema.parse(await res.json());
}

export async function fetchOAuthAppConnections(): Promise<OAuthAppConnection[]> {
  const res = await authFetch("/api/oauth/apps/connections");
  if (!res.ok) throw new Error(`Couldn't load app connections (${res.status})`);
  return oauthAppConnectionsSchema.parse(await res.json());
}

export async function startAppOAuth(appId: string) {
  const res = await authFetch(`/api/oauth/apps/${encodeURIComponent(appId)}/connect`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`OAuth start failed (${res.status})`);
  return startOAuthResponseSchema.parse(await res.json());
}

export async function disconnectApp(appId: string): Promise<void> {
  const res = await authFetch(
    `/api/oauth/apps/connections/${encodeURIComponent(appId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
}
