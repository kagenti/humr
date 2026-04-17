import { Hono } from "hono";
import crypto from "node:crypto";
import type { IdentityLinkService } from "../modules/channels/services/identity-link-service.js";
import type { IdentityProvider } from "../modules/channels/infrastructure/identity-links-repository.js";

export interface PendingOAuthFlow {
  provider: IdentityProvider;
  externalUserId: string;
  codeVerifier: string;
  createdAt: number;
  meta?: Record<string, string>;
}

const FLOW_TTL_MS = 10 * 60 * 1000;

export interface OAuthHelperDeps {
  provider: IdentityProvider;
  pending: Map<string, PendingOAuthFlow>;
  identityLinks: IdentityLinkService;
  keycloakExternalUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  callbackUrl: string;
}

export interface OAuthHelper {
  buildLoginUrl(externalUserId: string, meta?: Record<string, string>): string;
}

export function createOAuthHelper(deps: OAuthHelperDeps): OAuthHelper {
  return {
    buildLoginUrl(externalUserId: string, meta?: Record<string, string>): string {
      const state = crypto.randomUUID();
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      deps.pending.set(state, {
        provider: deps.provider,
        externalUserId,
        codeVerifier,
        createdAt: Date.now(),
        meta,
      });

      const authEndpoint = `${deps.keycloakExternalUrl}/realms/${deps.keycloakRealm}/protocol/openid-connect/auth`;
      const params = new URLSearchParams({
        response_type: "code",
        client_id: deps.keycloakClientId,
        redirect_uri: deps.callbackUrl,
        state,
        scope: "openid",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${authEndpoint}?${params}`;
    },
  };
}

export function createChannelOAuthRoutes(deps: {
  pending: Map<string, PendingOAuthFlow>;
  identityLinks: IdentityLinkService;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  callbackUrl: string;
  path: string;
}) {
  const routes = new Hono();

  routes.get(deps.path, async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) return c.text(`Login failed: ${error}`, 400);
    if (!code || !state) return c.text("Missing parameters", 400);

    const pending = deps.pending.get(state);
    if (!pending) return c.text("Invalid or expired state", 400);

    if (Date.now() - pending.createdAt > FLOW_TTL_MS) {
      deps.pending.delete(state);
      return c.text("Login link expired. Start login again.", 400);
    }
    deps.pending.delete(state);

    const tokenEndpoint = `${deps.keycloakUrl}/realms/${deps.keycloakRealm}/protocol/openid-connect/token`;
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: deps.callbackUrl,
        client_id: deps.keycloakClientId,
        code_verifier: pending.codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      process.stderr.write(`[channel-oauth] Token exchange failed: ${tokenRes.status} ${body}\n`);
      return c.text("Token exchange failed. Start login again.", 400);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
    };

    const payload = JSON.parse(
      Buffer.from(tokenData.access_token.split(".")[1], "base64url").toString(),
    ) as { sub: string };

    await deps.identityLinks.link(
      pending.provider,
      pending.externalUserId,
      payload.sub,
      tokenData.refresh_token ?? null,
    );

    return c.html("<html><body><h2>Account linked!</h2><p>You can close this window.</p></body></html>");
  });

  return routes;
}
