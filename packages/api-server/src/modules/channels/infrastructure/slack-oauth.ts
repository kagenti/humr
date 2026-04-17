import { Hono } from "hono";
import type { SlackOAuthPending } from "./slack.js";
import type { IdentityLinkService } from "./../services/identity-link-service.js";

const FLOW_TTL_MS = 10 * 60 * 1000;

export function createSlackOAuthRoutes(deps: {
  pendingFlows: Map<string, SlackOAuthPending>;
  identityLinks: IdentityLinkService;
  keycloakUrl: string;
  keycloakRealm: string;
  keycloakClientId: string;
  callbackUrl: string;
}) {
  const routes = new Hono();

  routes.get("/api/slack/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.text(`Login failed: ${error}`, 400);
    }

    if (!code || !state) {
      return c.text("Missing parameters", 400);
    }

    const pending = deps.pendingFlows.get(state);
    if (!pending) {
      return c.text("Invalid or expired state", 400);
    }

    if (Date.now() - pending.createdAt > FLOW_TTL_MS) {
      deps.pendingFlows.delete(state);
      return c.text("Login link expired. Run `/humr login` again.", 400);
    }

    deps.pendingFlows.delete(state);

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
      process.stderr.write(`[slack-oauth] Token exchange failed: ${tokenRes.status} ${body}\n`);
      return c.text("Token exchange failed. Run `/humr login` again.", 400);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
    };

    const payload = JSON.parse(
      Buffer.from(tokenData.access_token.split(".")[1], "base64url").toString(),
    ) as { sub: string };

    await deps.identityLinks.link(
      pending.slackUserId,
      payload.sub,
      tokenData.refresh_token ?? null,
    );

    return c.html("<html><body><h2>Account linked!</h2><p>You can close this window and return to Slack.</p></body></html>");
  });

  return routes;
}
