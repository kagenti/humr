/**
 * OAuth 2.1 flow for custom MCP servers.
 *
 * Handles: discovery → dynamic client registration → PKCE → token exchange.
 * Tokens are dual-written to OneCLI (legacy path) and a per-`(owner, connection)`
 * K8s Secret (Envoy sidecar path, ADR-033) until OneCLI is removed. The K8s
 * Secret is the source the refresh-token loop and the experimental Envoy
 * sidecar consume.
 *
 * Follows the MCP Authorization spec (OAuth 2.1 with PKCE + dynamic client
 * registration). All OneCLI operations are per-user via Keycloak token
 * exchange.
 */

import { Hono } from "hono";
import crypto from "node:crypto";
import type { OnecliClient } from "./onecli.js";
import type { UserIdentity } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  createK8sConnectionsPort,
  type ConnectionMetadata,
  type K8sConnectionsPort,
} from "../../modules/connections/infrastructure/k8s-connections-port.js";

// --- In-memory state store (PoC — not persistent across restarts) ---

interface OAuthPending {
  mcpOrigin: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
  redirectUri: string;
  hostPattern: string;
  userJwt: string;
  userSub: string;
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

// --- OneCLI helpers ---

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

async function listOnecliSecrets(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
): Promise<OnecliSecret[]> {
  const res = await oc.onecliFetch(userJwt, userSub, "/api/secrets");
  if (!res.ok) throw new Error(`OneCLI list secrets failed: ${res.status}`);
  return res.json() as Promise<OnecliSecret[]>;
}

/** List MCP connections managed by Humr (filtered by name prefix). */
export async function listMcpConnections(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
): Promise<{ hostname: string; connectedAt: string; expired: boolean }[]> {
  const secrets = await listOnecliSecrets(oc, userJwt, userSub);
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

/**
 * Best-effort K8s mirror — OneCLI remains the source of truth for the
 * non-flagged path. Logged with a stable token (`oauth-k8s-mirror-failed`)
 * so log scrapers can dashboard the failure mode.
 */
async function mirrorToK8s(
  meta: { op: "upsert" | "delete"; hostPattern: string },
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[oauth] oauth-k8s-mirror-failed",
      JSON.stringify({ ...meta, error: message }),
    );
  }
}

async function upsertOnecliSecret(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
  hostPattern: string,
  value: string,
  expiresAt?: number,
): Promise<void> {
  const name = mcpSecretName(hostPattern);

  // Delete existing secret with same name if present (upsert)
  const existing = await listOnecliSecrets(oc, userJwt, userSub);
  const old = existing.find((s) => s.name === name);
  if (old) {
    await oc.onecliFetch(userJwt, userSub, `/api/secrets/${old.id}`, {
      method: "DELETE",
    });
  }

  const res = await oc.onecliFetch(userJwt, userSub, "/api/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

export function createOAuthRoutes(uiBaseUrl: string, oc: OnecliClient, k8sClient: K8sClient) {
  const oauth = new Hono<{ Variables: { user: UserIdentity } }>();

  /** Extract the Bearer token from the Authorization header. */
  function getUserJwt(c: { req: { header: (name: string) => string | undefined } }): string {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("missing authorization header");
    return authHeader.slice(7);
  }

  function k8sConnectionsFor(userSub: string): K8sConnectionsPort {
    return createK8sConnectionsPort(k8sClient, userSub);
  }

  /**
   * GET /api/mcp/connections
   *
   * Merges OneCLI and K8s-backed MCP connections, preferring the K8s record
   * when both exist (it carries the freshest `expired` state from the refresh
   * loop). Legacy OneCLI-only entries from before the dual-write was
   * introduced surface unchanged.
   */
  oauth.get("/api/mcp/connections", async (c) => {
    try {
      const user = c.get("user");
      const jwt = getUserJwt(c);
      const [onecliConns, k8sConns] = await Promise.all([
        listMcpConnections(oc, jwt, user.sub),
        k8sConnectionsFor(user.sub).listConnections(),
      ]);
      const nowSec = Math.floor(Date.now() / 1000);
      const merged = new Map<
        string,
        { hostname: string; connectedAt: string; expired: boolean }
      >();
      for (const c of onecliConns) merged.set(c.hostname, c);
      for (const c of k8sConns) {
        const expired =
          c.status === "expired" || (c.expiresAt != null && c.expiresAt < nowSec);
        merged.set(c.connection, {
          hostname: c.connection,
          connectedAt: c.connectedAt ?? merged.get(c.connection)?.connectedAt ?? "",
          expired,
        });
      }
      return c.json(Array.from(merged.values()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * DELETE /api/mcp/connections/:hostname
   *
   * Dual-deletes: OneCLI is the source of truth today and its delete is
   * synchronous; the K8s mirror is best-effort so a hiccup on the K8s side
   * doesn't leave a stale OneCLI entry.
   */
  oauth.delete("/api/mcp/connections/:hostname", async (c) => {
    const hostname = c.req.param("hostname");
    try {
      const user = c.get("user");
      const jwt = getUserJwt(c);
      const secrets = await listOnecliSecrets(oc, jwt, user.sub);
      const secret = secrets.find((s) => s.name === mcpSecretName(hostname));
      // Both stores may have drifted independently (legacy K8s-only or
      // OneCLI-only entries). Treat 404 as "no OneCLI row" but still attempt
      // the K8s delete so the UI reaches a consistent state.
      if (secret) {
        const res = await oc.onecliFetch(jwt, user.sub, `/api/secrets/${secret.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`OneCLI delete failed: ${res.status}`);
      }
      await mirrorToK8s({ op: "delete", hostPattern: hostname }, () =>
        k8sConnectionsFor(user.sub).deleteConnection(hostname),
      );
      if (!secret) return c.json({ ok: true, deletedFrom: "k8s" });
      return c.json({ ok: true });
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
    const user = c.get("user");
    const jwt = getUserJwt(c);
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

    // 4. Store pending flow (includes user identity for callback)
    pendingFlows.set(state, {
      mcpOrigin: origin,
      tokenEndpoint: meta.token_endpoint,
      clientId,
      clientSecret,
      codeVerifier,
      redirectUri,
      hostPattern,
      userJwt: jwt,
      userSub: user.sub,
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

    // Dual-write: OneCLI (source of truth today, blocks the redirect on
    // failure) and the K8s connection Secret consumed by the Envoy sidecar
    // and the refresh loop (best-effort — a K8s hiccup must not break the
    // OAuth flow that's still backed by OneCLI on the non-flagged path).
    try {
      const expiresAt = tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : undefined;
      await upsertOnecliSecret(
        oc,
        pending.userJwt,
        pending.userSub,
        pending.hostPattern,
        tokenData.access_token,
        expiresAt,
      );
      const metadata: ConnectionMetadata = {
        hostPattern: pending.hostPattern,
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
        tokenUrl: pending.tokenEndpoint,
        clientId: pending.clientId,
        ...(pending.clientSecret ? { clientSecret: pending.clientSecret } : {}),
        grantType: "authorization_code",
      };
      await mirrorToK8s({ op: "upsert", hostPattern: pending.hostPattern }, () =>
        k8sConnectionsFor(pending.userSub).upsertConnection({
          connection: pending.hostPattern,
          tokens: {
            accessToken: tokenData.access_token,
            ...(tokenData.refresh_token ? { refreshToken: tokenData.refresh_token } : {}),
            ...(expiresAt != null ? { expiresAt } : {}),
          },
          metadata,
        }),
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
