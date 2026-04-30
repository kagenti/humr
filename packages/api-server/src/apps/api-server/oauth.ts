/**
 * OAuth 2.1 routes for the API Server: MCP servers (RFC 8414 discovery + RFC
 * 7591 dynamic client registration) and named "apps" (GitHub, GitHub
 * Enterprise) registered statically by the OAuthApp registry.
 *
 * Both flows go through the same engine and the same callback. Tokens are
 * dual-written to a per-`(owner, connection)` K8s `Secret` (consumed by the
 * Envoy sidecar and the refresh-token loop, ADR-033) and to OneCLI as a
 * generic secret keyed `__humr_mcp:<host>` (MCP) or `__humr_oauth:<conn>`
 * (apps). Removing the OneCLI write is a follow-up that runs after every
 * instance migrates off the OneCLI gateway.
 */

import { Hono } from "hono";
import type { OnecliClient } from "./onecli.js";
import type { UserIdentity } from "api-server-api";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import {
  createK8sConnectionsPort,
  type ConnectionMetadata,
  type K8sConnectionsPort,
} from "../../modules/connections/infrastructure/k8s-connections-port.js";
import {
  createOAuthEngine,
  type OAuthEngine,
} from "../../modules/connections/infrastructure/oauth-engine.js";
import type {
  OAuthApp,
  OAuthAppRegistry,
} from "../../modules/connections/infrastructure/oauth-apps.js";
import {
  deleteOAuthSecretViaOnecli,
  upsertOAuthSecretViaOnecli,
} from "../../modules/connections/infrastructure/onecli-oauth-mirror.js";

// ---------------------------------------------------------------------------
// MCP-side OneCLI helpers — preserved for backward compat with the
// `__humr_mcp:<host>` prefix that pre-existing connections use. The named-app
// flow uses the OAuth-mirror helpers in modules/connections instead.
// ---------------------------------------------------------------------------

const MCP_SECRET_PREFIX = "__humr_mcp:";

function mcpSecretName(hostname: string): string {
  return `${MCP_SECRET_PREFIX}${hostname}`;
}

interface OnecliSecret {
  id: string;
  name: string;
  type: string;
  hostPattern: string;
  injectionConfig: {
    headerName: string;
    valueFormat?: string;
    expiresAt?: number;
  } | null;
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

async function upsertOnecliMcpSecret(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
  hostPattern: string,
  value: string,
  expiresAt?: number,
): Promise<void> {
  const name = mcpSecretName(hostPattern);
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

/**
 * Stable token (`oauth-k8s-mirror-failed`) so log scrapers can dashboard the
 * mirror's failure mode. K8s and OneCLI mirrors are best-effort once the
 * primary write has succeeded; we don't fail the whole flow on a hiccup.
 */
async function bestEffort(
  meta: { op: string; target: string; identifier: string },
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[oauth] mirror-failed", JSON.stringify({ ...meta, error: message }));
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface OAuthRoutesDeps {
  uiBaseUrl: string;
  oc: OnecliClient;
  k8sClient: K8sClient;
  apps: OAuthAppRegistry;
  /** Override for tests — defaults to a fresh process-local engine. */
  engine?: OAuthEngine;
}

export function createOAuthRoutes(deps: OAuthRoutesDeps) {
  const { uiBaseUrl, oc, k8sClient, apps } = deps;
  const engine = deps.engine ?? createOAuthEngine();
  const oauth = new Hono<{ Variables: { user: UserIdentity } }>();

  function getUserJwt(c: { req: { header: (name: string) => string | undefined } }): string {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("missing authorization header");
    return authHeader.slice(7);
  }

  function k8sConnectionsFor(userSub: string): K8sConnectionsPort {
    return createK8sConnectionsPort(k8sClient, userSub);
  }

  // -------------------------------------------------------------------------
  // Named OAuth apps (GitHub, GitHub Enterprise)
  // -------------------------------------------------------------------------

  oauth.get("/api/oauth/apps", (c) => c.json(apps.listSummaries()));

  /**
   * Lists the user's connections to admin-configured OAuth apps. Reads from
   * the K8s connection store (source of truth for the experimental Envoy
   * path) and intersects with the configured app registry — apps the admin
   * removed from config no longer surface even if a Secret remains.
   */
  oauth.get("/api/oauth/apps/connections", async (c) => {
    try {
      const user = c.get("user");
      const k8sConns = await k8sConnectionsFor(user.sub).listConnections();
      const nowSec = Math.floor(Date.now() / 1000);
      const appConns = k8sConns
        .map((conn) => {
          const app = apps.list().find((a) => a.flow.connectionKey === conn.connection);
          if (!app) return null;
          const expired =
            conn.status === "expired" ||
            (conn.expiresAt != null && conn.expiresAt < nowSec);
          return {
            appId: app.id,
            displayName: app.displayName,
            hostPattern: app.flow.hostPattern,
            connectedAt: conn.connectedAt ?? "",
            expired,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return c.json(appConns);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * Kicks off an authorization-code flow for a configured app. Returns the
   * authorization URL the UI redirects the browser to. The callback below
   * lands the resulting tokens in K8s + OneCLI.
   */
  oauth.post("/api/oauth/apps/:id/connect", async (c) => {
    const id = c.req.param("id");
    const app = apps.get(id);
    if (!app) return c.json({ error: "Unknown app" }, 404);
    const user = c.get("user");
    const jwt = getUserJwt(c);
    const redirectUri = `${uiBaseUrl}/api/oauth/callback`;
    const { authUrl } = engine.start({
      provider: app.provider,
      flow: app.flow,
      redirectUri,
      userJwt: jwt,
      userSub: user.sub,
    });
    return c.json({ authUrl });
  });

  oauth.delete("/api/oauth/apps/connections/:id", async (c) => {
    const id = c.req.param("id");
    const app = apps.get(id);
    if (!app) return c.json({ error: "Unknown app" }, 404);
    const user = c.get("user");
    const jwt = getUserJwt(c);
    await bestEffort(
      { op: "delete", target: "k8s", identifier: app.id },
      () => k8sConnectionsFor(user.sub).deleteConnection(app.flow.connectionKey),
    );
    await bestEffort(
      { op: "delete", target: "onecli", identifier: app.id },
      () => deleteOAuthSecretViaOnecli(oc, jwt, user.sub, app.flow.connectionKey),
    );
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // MCP servers (preserved external API)
  // -------------------------------------------------------------------------

  oauth.get("/api/mcp/connections", async (c) => {
    try {
      const user = c.get("user");
      const jwt = getUserJwt(c);
      const [onecliConns, k8sConns] = await Promise.all([
        listMcpConnections(oc, jwt, user.sub),
        k8sConnectionsFor(user.sub).listConnections(),
      ]);
      const appKeys = new Set(apps.list().map((a) => a.flow.connectionKey));
      const nowSec = Math.floor(Date.now() / 1000);
      const merged = new Map<string, { hostname: string; connectedAt: string; expired: boolean }>();
      for (const conn of onecliConns) merged.set(conn.hostname, conn);
      for (const conn of k8sConns) {
        // Skip rows owned by the named-app flow — those surface under
        // /api/oauth/apps/connections, not the MCP list.
        if (appKeys.has(conn.connection)) continue;
        const expired =
          conn.status === "expired" || (conn.expiresAt != null && conn.expiresAt < nowSec);
        merged.set(conn.connection, {
          hostname: conn.connection,
          connectedAt: conn.connectedAt ?? merged.get(conn.connection)?.connectedAt ?? "",
          expired,
        });
      }
      return c.json(Array.from(merged.values()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  oauth.delete("/api/mcp/connections/:hostname", async (c) => {
    const hostname = c.req.param("hostname");
    try {
      const user = c.get("user");
      const jwt = getUserJwt(c);
      const secrets = await listOnecliSecrets(oc, jwt, user.sub);
      const secret = secrets.find((s) => s.name === mcpSecretName(hostname));
      if (secret) {
        const res = await oc.onecliFetch(jwt, user.sub, `/api/secrets/${secret.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`OneCLI delete failed: ${res.status}`);
      }
      await bestEffort(
        { op: "delete", target: "k8s", identifier: hostname },
        () => k8sConnectionsFor(user.sub).deleteConnection(hostname),
      );
      if (!secret) return c.json({ ok: true, deletedFrom: "k8s" });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: msg }, 500);
    }
  });

  /**
   * Kicks off an MCP OAuth flow: discovers the AS metadata at the MCP
   * server's origin, registers a public client via DCR, then hands off to
   * the engine for the PKCE auth-code dance.
   */
  oauth.post("/api/oauth/start", async (c) => {
    const user = c.get("user");
    const jwt = getUserJwt(c);
    const body = await c.req.json<{ mcpServerUrl: string }>();
    const mcpUrl = new URL(body.mcpServerUrl);
    const origin = mcpUrl.origin;
    const hostPattern = mcpUrl.hostname;

    const metaRes = await fetch(`${origin}/.well-known/oauth-authorization-server`);
    if (!metaRes.ok) {
      return c.json({ error: "MCP server does not support OAuth discovery" }, 400);
    }
    const meta = (await metaRes.json()) as {
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
    };

    if (!meta.registration_endpoint) {
      return c.json(
        { error: "MCP server does not support dynamic client registration" },
        400,
      );
    }

    const redirectUri = `${uiBaseUrl}/api/oauth/callback`;
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
        { error: `Client registration failed: ${regRes.status} ${errBody}` },
        400,
      );
    }
    const regData = (await regRes.json()) as { client_id: string; client_secret?: string };

    const { authUrl, state } = engine.start({
      provider: {
        id: `mcp:${hostPattern}`,
        authorizationUrl: meta.authorization_endpoint,
        tokenEndpoint: meta.token_endpoint,
        clientId: regData.client_id,
        ...(regData.client_secret ? { clientSecret: regData.client_secret } : {}),
      },
      flow: { connectionKey: hostPattern, hostPattern },
      redirectUri,
      userJwt: jwt,
      userSub: user.sub,
    });
    return c.json({ authUrl, state });
  });

  // -------------------------------------------------------------------------
  // Unified callback for every flow the engine started
  // -------------------------------------------------------------------------

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
    const pending = engine.consume(state);
    if (!pending) {
      return c.redirect(`${uiBaseUrl}?oauth=error&message=invalid+state`);
    }

    let tokens;
    try {
      tokens = await engine.exchange(pending, code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.redirect(
        `${uiBaseUrl}?oauth=error&message=${encodeURIComponent(msg)}`,
      );
    }

    // Decide the OneCLI mirror flavor from the provider id. Apps (GitHub,
    // GHE) get the OAuth prefix; MCP keeps its legacy `__humr_mcp:` prefix
    // so existing entries stay addressable.
    const isMcp = pending.provider.id.startsWith("mcp:");

    try {
      if (isMcp) {
        await upsertOnecliMcpSecret(
          oc,
          pending.userJwt,
          pending.userSub,
          pending.flow.hostPattern,
          tokens.accessToken,
          tokens.expiresAt,
        );
      } else {
        await upsertOAuthSecretViaOnecli(oc, pending.userJwt, pending.userSub, {
          connection: pending.flow.connectionKey,
          hostPattern: pending.flow.hostPattern,
          accessToken: tokens.accessToken,
          ...(tokens.expiresAt != null ? { expiresAt: tokens.expiresAt } : {}),
        });
      }
    } catch (err) {
      // OneCLI is the source of truth on the non-flagged path — failing here
      // means the user's existing pods can't use the credential. Surface the
      // error rather than silently writing only the K8s mirror.
      const msg = err instanceof Error ? err.message : "Unknown error";
      return c.redirect(`${uiBaseUrl}?oauth=error&message=${encodeURIComponent(msg)}`);
    }

    const metadata: ConnectionMetadata = {
      hostPattern: pending.flow.hostPattern,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
      tokenUrl: pending.provider.tokenEndpoint,
      clientId: pending.provider.clientId,
      ...(pending.provider.clientSecret ? { clientSecret: pending.provider.clientSecret } : {}),
      grantType: "authorization_code",
    };
    await bestEffort(
      { op: "upsert", target: "k8s", identifier: pending.flow.connectionKey },
      () =>
        k8sConnectionsFor(pending.userSub).upsertConnection({
          connection: pending.flow.connectionKey,
          tokens: {
            accessToken: tokens.accessToken,
            ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
            ...(tokens.expiresAt != null ? { expiresAt: tokens.expiresAt } : {}),
          },
          metadata,
        }),
    );

    const successQuery = isMcp
      ? `oauth=success&host=${pending.flow.hostPattern}`
      : `oauth=success&app=${encodeURIComponent(pending.flow.connectionKey)}`;
    return c.redirect(`${uiBaseUrl}?${successQuery}`);
  });

  return oauth;
}

export type { OAuthApp };
