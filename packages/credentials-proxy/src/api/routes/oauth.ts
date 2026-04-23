import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "db";
import { cpSecrets } from "db";
import type { KeyRing } from "../../crypto/key.js";
import { encryptSecret } from "../crypto.js";
import { decodeState, encodeState } from "../oauth/state.js";
import { exchangeCode } from "../oauth/exchange.js";
import { loadProviders, publicView, type OAuthProvider } from "../oauth/providers.js";

const startInput = z.object({
  providerId: z.string().min(1),
  scopes: z.string().optional(),
  secretName: z.string().min(1).max(128),
});

export interface OAuthRoutesOptions {
  db: Db;
  keyRing: KeyRing;
  macKey: Buffer;
  callbackUrl: string;
  providers?: Map<string, OAuthProvider>;
}

export function oauthRoutes(opts: OAuthRoutesOptions) {
  const providers = opts.providers ?? loadProviders();
  const router = new Hono();

  router.get("/providers", (c) => {
    return c.json([...providers.values()].map(publicView));
  });

  router.post("/start", async (c) => {
    const user = c.get("user");
    const body = startInput.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "invalid body", details: body.error.issues }, 400);
    const provider = providers.get(body.data.providerId);
    if (!provider) return c.json({ error: "unknown provider" }, 400);

    const state = encodeState(opts.macKey, { userSub: user.sub, providerId: provider.id });
    const url = new URL(provider.authorizationUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", opts.callbackUrl);
    url.searchParams.set("scope", body.data.scopes ?? provider.defaultScopes);
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline"); // Google needs this for refresh tokens; others ignore.
    // Save secretName in state by re-encoding — the state payload only carries userSub + providerId,
    // so stash the pending name in a short-lived cookie instead for single-tab flows.
    c.header("Set-Cookie", `cp_oauth_name=${encodeURIComponent(body.data.secretName)}; Max-Age=600; HttpOnly; SameSite=Lax; Path=/api/oauth/callback`);
    return c.json({ authorizeUrl: url.toString() });
  });

  router.get("/callback", async (c) => {
    const code = c.req.query("code");
    const stateToken = c.req.query("state");
    const error = c.req.query("error");
    if (error) return c.text(`oauth error: ${error}`, 400);
    if (!code || !stateToken) return c.text("missing code or state", 400);

    let state;
    try {
      state = decodeState(opts.macKey, stateToken);
    } catch (err) {
      return c.text(`bad state: ${(err as Error).message}`, 400);
    }
    const provider = providers.get(state.providerId);
    if (!provider) return c.text("unknown provider", 400);

    const cookie = c.req.header("cookie") ?? "";
    const nameMatch = cookie.match(/(?:^|;\s*)cp_oauth_name=([^;]+)/);
    const secretName = nameMatch ? decodeURIComponent(nameMatch[1]!) : `${provider.id}-oauth`;

    let tokens;
    try {
      tokens = await exchangeCode(provider, code, opts.callbackUrl);
    } catch (err) {
      return c.text(`token exchange failed: ${(err as Error).message}`, 502);
    }

    const enc = encryptSecret(opts.keyRing, tokens.accessToken);
    const metadata = {
      authMode: "oauth" as const,
      injectionConfig: provider.injectionConfig,
      oauth: {
        providerId: provider.id,
        scopes: tokens.scope,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn
          ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
          : undefined,
      },
    };
    await opts.db.insert(cpSecrets).values({
      name: secretName,
      type: provider.id === "anthropic" ? "anthropic" : "oauth",
      hostPattern: provider.hostPattern,
      ciphertext: enc.ciphertext,
      wrappedDek: enc.wrappedDek,
      kekVersion: enc.kekVersion,
      metadata,
      ownerSub: state.userSub,
    });

    c.header("Set-Cookie", "cp_oauth_name=; Max-Age=0; Path=/api/oauth/callback");
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Connected</title><p>Connected ${provider.id}. You can close this tab.</p>`,
    );
  });

  return router;
}
