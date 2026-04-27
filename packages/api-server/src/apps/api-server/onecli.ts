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

  /**
   * Service account token via client_credentials. Used as the subject for
   * RFC 8693 impersonation when calling OneCLI on behalf of an owner whose
   * JWT we don't have (e.g. background SSE handlers serving an agent pod).
   */
  async function getServiceAccountToken(): Promise<string> {
    const cached = tokenCache.get("__service_account__");
    if (cached && cached.expiresAt > Date.now() / 1000 + TOKEN_MARGIN_SECONDS) {
      return cached.accessToken;
    }
    const res = await fetch(config.keycloakTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`Service account token: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 300);
    tokenCache.set("__service_account__", { accessToken: data.access_token, expiresAt });
    return data.access_token;
  }

  /** Exchange a service account token for an owner-scoped token via impersonation. */
  async function exchangeForOwner(owner: string): Promise<string> {
    const cacheKey = `owner:${owner}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() / 1000 + TOKEN_MARGIN_SECONDS) {
      return cached.accessToken;
    }
    const saToken = await getServiceAccountToken();
    const res = await fetch(config.keycloakTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        subject_token: saToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        requested_subject: owner,
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        audience: config.onecliAudience,
      }),
    });
    if (!res.ok) throw new Error(`Owner impersonation for ${owner}: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 300);
    tokenCache.set(cacheKey, { accessToken: data.access_token, expiresAt });
    return data.access_token;
  }

  /** Make an authenticated OneCLI API call on behalf of an owner (no live JWT). */
  async function onecliFetchAsOwner(
    owner: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const token = await exchangeForOwner(owner);
    return fetch(`${config.onecliBaseUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  }

  /** Sync user account in OneCLI (creates if not exists). */
  async function syncUser(userJwt: string, userSub: string): Promise<void> {
    const token = await exchangeToken(userJwt, userSub);
    const res = await fetch(`${config.onecliBaseUrl}/api/auth/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OneCLI sync failed: ${res.status} ${body}`);
    }
  }

  return { exchangeToken, getApiKey, onecliFetch, onecliFetchAsOwner, syncUser };
}

export type OnecliClient = ReturnType<typeof createOnecliClient>;
