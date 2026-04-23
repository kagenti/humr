import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
}

export interface AuthConfig {
  issuerUrl: string;
  jwksUrl: string;
  audience: string;
}

declare module "hono" {
  interface ContextVariableMap {
    user: UserIdentity;
  }
}

// Paths that skip the bearer check — the CA endpoint needs to be reachable by
// unauth'd cluster clients (init lifecycle) and the OAuth callback is a
// browser-driven redirect that carries its own HMAC'd state.
const PUBLIC_PATHS = new Set(["/api/health", "/api/gateway/ca", "/api/oauth/callback"]);

export function createAuthMiddleware(config: AuthConfig): MiddlewareHandler {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));

  return async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);

    try {
      const { payload } = await jwtVerify(header.slice(7), jwks, {
        issuer: config.issuerUrl,
        audience: config.audience,
        algorithms: ["RS256"],
      });
      c.set("user", {
        sub: payload.sub!,
        preferredUsername:
          ((payload as Record<string, unknown>).preferred_username as string) ?? payload.sub!,
      });
      return next();
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
  };
}
