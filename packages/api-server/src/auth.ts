import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
}

export interface AuthConfig {
  /** External issuer URL (matches token `iss` claim), e.g. http://keycloak.localhost:4444/realms/humr */
  issuerUrl: string;
  /** Internal JWKS endpoint for key fetching, e.g. http://humr-keycloak:8080/realms/humr/protocol/openid-connect/certs */
  jwksUrl: string;
  /** Expected audience in access tokens (e.g. "humr-api") */
  audience?: string;
}

const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/config"]);

export function createAuth(config: AuthConfig) {
  const JWKS = createRemoteJWKSet(new URL(config.jwksUrl));

  async function verify(token: string): Promise<UserIdentity> {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: config.issuerUrl,
      audience: config.audience,
      algorithms: ["RS256"],
    });
    return {
      sub: payload.sub!,
      preferredUsername:
        (payload as Record<string, unknown>).preferred_username as string ??
        payload.sub!,
    };
  }

  const middleware: MiddlewareHandler = async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    try {
      const user = await verify(authHeader.slice(7));
      c.set("user", user);
      return next();
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
  };

  return { middleware, verify };
}
