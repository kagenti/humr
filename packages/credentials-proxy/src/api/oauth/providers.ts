export interface OAuthProvider {
  id: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  defaultScopes: string;
  /** Host pattern to seed on the resulting secret (used for MITM matching). */
  hostPattern: string;
  /** Header injection rule for the resulting secret. */
  injectionConfig: { headerName: string; valueFormat?: string };
}

/**
 * Load provider configs from env. Each provider uses a name-spaced prefix:
 *   OAUTH_GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET
 *   OAUTH_GOOGLE_CLIENT_ID, OAUTH_GOOGLE_CLIENT_SECRET
 * Only providers with both client id and secret set are registered.
 */
export function loadProviders(env: NodeJS.ProcessEnv = process.env): Map<string, OAuthProvider> {
  const providers = new Map<string, OAuthProvider>();

  const github = {
    id: "github",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientId: env.OAUTH_GITHUB_CLIENT_ID ?? "",
    clientSecret: env.OAUTH_GITHUB_CLIENT_SECRET ?? "",
    defaultScopes: env.OAUTH_GITHUB_SCOPES ?? "repo read:user",
    hostPattern: "api.github.com",
    injectionConfig: { headerName: "Authorization", valueFormat: "Bearer {{value}}" },
  };
  if (github.clientId && github.clientSecret) providers.set(github.id, github);

  const google = {
    id: "google",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: env.OAUTH_GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET ?? "",
    defaultScopes: env.OAUTH_GOOGLE_SCOPES ?? "openid email profile",
    hostPattern: "*.googleapis.com",
    injectionConfig: { headerName: "Authorization", valueFormat: "Bearer {{value}}" },
  };
  if (google.clientId && google.clientSecret) providers.set(google.id, google);

  return providers;
}

export function publicView(p: OAuthProvider): { id: string; defaultScopes: string; hostPattern: string } {
  return { id: p.id, defaultScopes: p.defaultScopes, hostPattern: p.hostPattern };
}
