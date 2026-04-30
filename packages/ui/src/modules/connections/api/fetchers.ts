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

const oauthAppInputSchema = z.object({
  name: z.string(),
  label: z.string(),
  secret: z.boolean().optional(),
  placeholder: z.string().optional(),
  helper: z.string().optional(),
});

const oauthAppDescriptorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string(),
  connectionKey: z.string(),
  inputs: z.array(oauthAppInputSchema),
  registrationUrl: z.string().optional(),
});
const oauthAppsSchema = z.array(oauthAppDescriptorSchema);
export type OAuthAppDescriptor = z.infer<typeof oauthAppDescriptorSchema>;
export type OAuthAppInputField = z.infer<typeof oauthAppInputSchema>;

const oauthAppConnectionSchema = z.object({
  appId: z.string(),
  displayName: z.string(),
  hostPattern: z.string(),
  connectedAt: z.string(),
  expired: z.boolean(),
});
const oauthAppConnectionsSchema = z.array(oauthAppConnectionSchema);
export type OAuthAppConnection = z.infer<typeof oauthAppConnectionSchema>;

export async function fetchOAuthApps(): Promise<OAuthAppDescriptor[]> {
  const res = await authFetch("/api/oauth/apps");
  if (!res.ok) throw new Error(`Couldn't load OAuth apps (${res.status})`);
  return oauthAppsSchema.parse(await res.json());
}

export async function fetchOAuthAppConnections(): Promise<OAuthAppConnection[]> {
  const res = await authFetch("/api/oauth/apps/connections");
  if (!res.ok) throw new Error(`Couldn't load app connections (${res.status})`);
  return oauthAppConnectionsSchema.parse(await res.json());
}

export async function startAppOAuth(args: { appId: string; input: Record<string, string> }) {
  const res = await authFetch(`/api/oauth/apps/${encodeURIComponent(args.appId)}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.input),
  });
  if (!res.ok) {
    // Surface the server's validation message if present (4xx body is a JSON
    // `{ error }` shape; tolerate non-JSON failure modes).
    let detail = `OAuth start failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return startOAuthResponseSchema.parse(await res.json());
}

export async function disconnectApp(appId: string): Promise<void> {
  const res = await authFetch(
    `/api/oauth/apps/connections/${encodeURIComponent(appId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
}
