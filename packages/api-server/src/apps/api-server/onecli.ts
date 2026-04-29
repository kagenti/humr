/**
 * OneCLI client. Owns every Keycloak/OneCLI auth interaction in the api-server:
 *
 * - User-JWT path: exchangeToken → call OneCLI on behalf of an authenticated user.
 * - Impersonation path: impersonate(sub) → call OneCLI on behalf of a user we
 *   don't have a live JWT for (background SSE handlers, foreign-user fork
 *   creation). Implemented as RFC 8693 client_credentials → token-exchange with
 *   `requested_subject`.
 *
 * Both paths share an in-memory token cache and the same Keycloak/audience config,
 * so this is the single place that implements the auth dance.
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
const SERVICE_ACCOUNT_CACHE_KEY = "__service_account__";

export function createOnecliClient(config: TokenExchangeConfig) {
  const tokenCache = new Map<string, CachedToken>();

  function cacheHit(key: string): string | null {
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() / 1000 + TOKEN_MARGIN_SECONDS) {
      return cached.accessToken;
    }
    return null;
  }

  async function postKeycloak(
    params: URLSearchParams,
    errLabel: string,
  ): Promise<{ access_token: string; expires_in?: number }> {
    const res = await fetch(config.keycloakTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) {
      throw new Error(`${errLabel}: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { access_token: string; expires_in?: number };
  }

  function cacheToken(key: string, data: { access_token: string; expires_in?: number }): string {
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 300);
    tokenCache.set(key, { accessToken: data.access_token, expiresAt });
    return data.access_token;
  }

  /** Exchange a user's JWT for a OneCLI-scoped access token. */
  async function exchangeToken(userJwt: string, userSub: string): Promise<string> {
    const hit = cacheHit(userSub);
    if (hit) return hit;
    const data = await postKeycloak(
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        subject_token: userJwt,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        audience: config.onecliAudience,
      }),
      "Token exchange failed",
    );
    return cacheToken(userSub, data);
  }

  /**
   * Service account token via client_credentials. Used as the subject for
   * RFC 8693 impersonation in `impersonate`.
   */
  async function getServiceAccountToken(): Promise<string> {
    const hit = cacheHit(SERVICE_ACCOUNT_CACHE_KEY);
    if (hit) return hit;
    const data = await postKeycloak(
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      "Service account token",
    );
    return cacheToken(SERVICE_ACCOUNT_CACHE_KEY, data);
  }

  /**
   * Impersonate a Keycloak subject — RFC 8693 token-exchange with
   * `requested_subject`. Used both for foreign-user fork creation and for
   * background SSE handlers acting on behalf of an agent's owner.
   */
  async function impersonate(sub: string): Promise<string> {
    const cacheKey = `sub:${sub}`;
    const hit = cacheHit(cacheKey);
    if (hit) return hit;
    const saToken = await getServiceAccountToken();
    const data = await postKeycloak(
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        subject_token: saToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        requested_subject: sub,
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        audience: config.onecliAudience,
      }),
      `Impersonation for ${sub}`,
    );
    return cacheToken(cacheKey, data);
  }

  /** Primitive: call OneCLI with a pre-acquired token. */
  async function onecliFetchWithToken(
    token: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    return fetch(`${config.onecliBaseUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  }

  /** Fetch the user's OneCLI API key (provisions account on first call). */
  async function getApiKey(userJwt: string, userSub: string): Promise<string> {
    const token = await exchangeToken(userJwt, userSub);
    const res = await onecliFetchWithToken(token, "/api/user/api-key");
    if (!res.ok) {
      throw new Error(`OneCLI get API key failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { apiKey: string };
    return data.apiKey;
  }

  /** Make an authenticated OneCLI API call on behalf of the user (live JWT). */
  async function onecliFetch(
    userJwt: string,
    userSub: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const token = await exchangeToken(userJwt, userSub);
    return onecliFetchWithToken(token, path, init);
  }

  /** Make an authenticated OneCLI API call on behalf of `sub` via impersonation. */
  async function onecliFetchAs(
    sub: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const token = await impersonate(sub);
    return onecliFetchWithToken(token, path, init);
  }

  /** Sync user account in OneCLI (creates if not exists). */
  async function syncUser(userJwt: string, userSub: string): Promise<void> {
    const token = await exchangeToken(userJwt, userSub);
    const res = await onecliFetchWithToken(token, "/api/auth/sync");
    if (!res.ok) {
      throw new Error(`OneCLI sync failed: ${res.status} ${await res.text()}`);
    }
  }

  return {
    exchangeToken,
    impersonate,
    getApiKey,
    onecliFetch,
    onecliFetchAs,
    onecliFetchWithToken,
    syncUser,
  };
}

export type OnecliClient = ReturnType<typeof createOnecliClient>;
