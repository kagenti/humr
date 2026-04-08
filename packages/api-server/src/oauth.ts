/**
 * OAuth 2.1 flow for custom MCP servers.
 *
 * Handles: discovery → dynamic client registration → PKCE → token exchange → store in OneCLI.
 * Follows the MCP Authorization spec (OAuth 2.1 with PKCE + dynamic client registration).
 */

import { Hono } from "hono";
import crypto from "node:crypto";

// --- In-memory state store (PoC — not persistent across restarts) ---

interface OAuthPending {
  mcpOrigin: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
  redirectUri: string;
  hostPattern: string;
  createdAt: number;
}

const pendingFlows = new Map<string, OAuthPending>();

// Clean up stale entries older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, val] of pendingFlows) {
    if (val.createdAt < cutoff) pendingFlows.delete(key);
  }
}, 60_000);

// --- PKCE helpers ---

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// --- OneCLI client ---

const onecliBaseUrl = process.env.ONECLI_WEB_URL ?? "http://humr-onecli:10254";
let onecliApiKey: string | null = null;

async function ensureOnecliApiKey(): Promise<string> {
  if (onecliApiKey) return onecliApiKey;
  const res = await fetch(`${onecliBaseUrl}/api/user/api-key`);
  if (!res.ok) throw new Error(`OneCLI not ready: ${res.status}`);
  const data = (await res.json()) as { apiKey: string };
  onecliApiKey = data.apiKey;
  return onecliApiKey;
}

/** Prefix for secrets managed by Humr MCP connectors. */
const MCP_SECRET_PREFIX = "__humr_mcp:";

function mcpSecretName(hostname: string): string {
  return `${MCP_SECRET_PREFIX}${hostname}`;
}

interface McpInjectionConfig {
  headerName: string;
  valueFormat?: string;
  expiresAt?: number;
  refreshToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

interface OnecliSecret {
  id: string;
  name: string;
  type: string;
  hostPattern: string;
  injectionConfig: McpInjectionConfig | null;
  createdAt: string;
}

async function listOnecliSecrets(): Promise<OnecliSecret[]> {
  const apiKey = await ensureOnecliApiKey();
  const res = await fetch(`${onecliBaseUrl}/api/secrets`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OneCLI list secrets failed: ${res.status}`);
  return res.json() as Promise<OnecliSecret[]>;
}

/** List MCP connections managed by Humr (filtered by name prefix). */
export async function listMcpConnections(): Promise<
  { hostname: string; connectedAt: string; expired: boolean }[]
> {
  const secrets = await listOnecliSecrets();
  const now = Math.floor(Date.now() / 1000);
  return secrets
    .filter((s) => s.name.startsWith(MCP_SECRET_PREFIX))
    .map((s) => {
      const hostname = s.name.slice(MCP_SECRET_PREFIX.length);
      const expiresAt = s.injectionConfig?.expiresAt;
      return {
        hostname,
        connectedAt: s.createdAt,
        expired: expiresAt != null && expiresAt < now,
      };
    });
}

async function upsertOnecliSecret(
  hostPattern: string,
  value: string,
  expiresAt?: number,
): Promise<void> {
  const apiKey = await ensureOnecliApiKey();
  const name = mcpSecretName(hostPattern);

  // Delete existing secret with same name if present (upsert)
  const existing = await listOnecliSecrets();
  const old = existing.find((s) => s.name === name);
  if (old) {
    await fetch(`${onecliBaseUrl}/api/secrets/${old.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }

  const res = await fetch(`${onecliBaseUrl}/api/secrets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name,
      type: "generic",
      value,
      hostPattern,
      injectionConfig: {
        headerName: "authorization",
        valueFormat: "Bearer {value}",
        ...(expiresAt != null && { expiresAt }),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OneCLI create secret failed: ${res.status} ${body}`);
  }
}

// --- OAuth routes ---

export function createOAuthRoutes(uiBaseUrl: string) {
  const oauth = new Hono();

  /**
   * GET /api/mcp/connections
   *
   * Returns list of MCP server hosts that have credentials stored in OneCLI.
   */
  oauth.get("/api/mcp/connections", async (c) => {
    try {
      const connections = await listMcpConnections();
      return c.json(connections);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * POST /api/oauth/start
   * Body: { mcpServerUrl: string }
   *
   * Discovers OAuth metadata, registers a client, generates PKCE,
   * returns { authUrl } for the UI to redirect to.
   */
  oauth.post("/api/oauth/start", async (c) => {
    const body = await c.req.json<{ mcpServerUrl: string }>();
    const mcpUrl = new URL(body.mcpServerUrl);
    const origin = mcpUrl.origin;
    const hostPattern = mcpUrl.hostname;

    // 1. Discover OAuth metadata
    const metaRes = await fetch(
      `${origin}/.well-known/oauth-authorization-server`,
    );
    if (!metaRes.ok) {
      return c.json(
        { error: "MCP server does not support OAuth discovery" },
        400,
      );
    }
    const meta = (await metaRes.json()) as {
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
    };

    // 2. Dynamic client registration (if supported)
    let clientId: string;
    let clientSecret: string | undefined;
    const redirectUri = `${uiBaseUrl}/api/oauth/callback`;

    if (meta.registration_endpoint) {
      const regRes = await fetch(meta.registration_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Humr Agent Platform",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      if (!regRes.ok) {
        const errBody = await regRes.text();
        return c.json(
          {
            error: `Client registration failed: ${regRes.status} ${errBody}`,
          },
          400,
        );
      }
      const regData = (await regRes.json()) as {
        client_id: string;
        client_secret?: string;
      };
      clientId = regData.client_id;
      clientSecret = regData.client_secret;
    } else {
      return c.json(
        { error: "MCP server does not support dynamic client registration" },
        400,
      );
    }

    // 3. Generate PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString("hex");

    // 4. Store pending flow
    pendingFlows.set(state, {
      mcpOrigin: origin,
      tokenEndpoint: meta.token_endpoint,
      clientId,
      clientSecret,
      codeVerifier,
      redirectUri,
      hostPattern,
      createdAt: Date.now(),
    });

    // 5. Build authorization URL
    const authUrl = new URL(meta.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return c.json({ authUrl: authUrl.toString(), state });
  });

  /**
   * GET /api/oauth/callback?code=...&state=...
   *
   * Exchanges the authorization code for tokens, stores in OneCLI as a Secret,
   * redirects back to UI.
   */
  oauth.get("/api/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.redirect(
        `${uiBaseUrl}?oauth=error&message=${encodeURIComponent(error)}`,
      );
    }

    if (!code || !state) {
      return c.redirect(`${uiBaseUrl}?oauth=error&message=missing+parameters`);
    }

    const pending = pendingFlows.get(state);
    if (!pending) {
      return c.redirect(`${uiBaseUrl}?oauth=error&message=invalid+state`);
    }
    pendingFlows.delete(state);

    // Exchange code for token
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
    });
    if (pending.clientSecret) {
      tokenParams.set("client_secret", pending.clientSecret);
    }

    const tokenRes = await fetch(pending.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams,
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      return c.redirect(
        `${uiBaseUrl}?oauth=error&message=${encodeURIComponent(`Token exchange failed: ${errBody}`)}`,
      );
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
    };

    // Store in OneCLI as a generic secret (upsert — replaces existing)
    try {
      const expiresAt = tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : undefined;
      await upsertOnecliSecret(
        pending.hostPattern,
        tokenData.access_token,
        expiresAt,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.redirect(
        `${uiBaseUrl}?oauth=error&message=${encodeURIComponent(msg)}`,
      );
    }

    return c.redirect(`${uiBaseUrl}?oauth=success&host=${pending.hostPattern}`);
  });

  return oauth;
}
