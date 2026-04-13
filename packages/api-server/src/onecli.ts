/**
 * Per-user OneCLI client via Keycloak RFC 8693 token exchange.
 *
 * The API server exchanges the user's Keycloak JWT for a OneCLI-scoped token,
 * then uses that token to call OneCLI APIs on behalf of the user.
 */

export interface TokenExchangeConfig {
  /** Internal Keycloak token endpoint, e.g. http://humr-keycloak:8080/realms/humr/protocol/openid-connect/token */
  keycloakTokenUrl: string;
  /** Confidential client ID for the API server (e.g. "humr-api") */
  clientId: string;
  /** Confidential client secret */
  clientSecret: string;
  /** Target audience for OneCLI tokens (e.g. "onecli") */
  onecliAudience: string;
  /** OneCLI web API base URL (e.g. http://humr-onecli:10254) */
  onecliBaseUrl: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const TOKEN_MARGIN_SECONDS = 30;

/**
 * Creates a per-user OneCLI client factory.
 *
 * Exchanges user JWTs for OneCLI-scoped tokens via Keycloak,
 * with an in-memory cache keyed by user subject.
 */
export function createOnecliClient(config: TokenExchangeConfig) {
  const tokenCache = new Map<string, CachedToken>();

  /** Exchange a user's JWT for a OneCLI-scoped access token. */
  async function exchangeToken(userJwt: string, userSub: string): Promise<string> {
    const cached = tokenCache.get(userSub);
    if (cached && cached.expiresAt > Date.now() / 1000 + TOKEN_MARGIN_SECONDS) {
      return cached.accessToken;
    }

    const params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      subject_token: userJwt,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: config.onecliAudience,
    });

    const res = await fetch(config.keycloakTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? Math.floor(Date.now() / 1000) + data.expires_in
      : Math.floor(Date.now() / 1000) + 300; // default 5min

    tokenCache.set(userSub, { accessToken: data.access_token, expiresAt });
    return data.access_token;
  }

  /** Fetch the user's OneCLI API key (provisions account on first call). */
  async function getApiKey(userJwt: string, userSub: string): Promise<string> {
    const token = await exchangeToken(userJwt, userSub);
    const res = await fetch(`${config.onecliBaseUrl}/api/user/api-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OneCLI get API key failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { apiKey: string };
    return data.apiKey;
  }

  /** Make an authenticated OneCLI API call on behalf of the user. */
  async function onecliFetch(
    userJwt: string,
    userSub: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const token = await exchangeToken(userJwt, userSub);
    return fetch(`${config.onecliBaseUrl}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return { exchangeToken, getApiKey, onecliFetch };
}

export type OnecliClient = ReturnType<typeof createOnecliClient>;
