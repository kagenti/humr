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
