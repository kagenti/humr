/**
 * Static registry of named OAuth providers ("apps") the API Server drives
 * directly — replacing the OneCLI dashboard's "Connect GitHub" UX. Each app
 * binds:
 *   - the OAuth metadata the engine needs (auth/token URLs, scopes, client
 *     credentials), pulled from admin config (env vars);
 *   - the storage shape (connection key + host pattern) the K8s connection
 *     port and OneCLI mirror write under.
 *
 * GitHub.com is fully static. GitHub Enterprise is per-deployment static —
 * one admin-configured GHE host per platform; multi-host GHE (each user
 * registers their own GHE OAuth app) is a follow-up.
 */
import {
  type OAuthFlowMetadata,
  type OAuthFlowProvider,
} from "./oauth-engine.js";

export interface OAuthApp {
  /** Stable id used in URLs and the UI. */
  id: string;
  displayName: string;
  /** Single-line summary shown beneath the Connect button. */
  description: string;
  provider: OAuthFlowProvider;
  flow: OAuthFlowMetadata;
}

/**
 * Public-facing app summary used by the UI to render a "Connect <X>" button.
 * Excludes everything the browser shouldn't see.
 */
export interface OAuthAppSummary {
  id: string;
  displayName: string;
  description: string;
  hostPattern: string;
}

export interface OAuthAppsConfig {
  /**
   * Required for the engine to know where to land the user; same value the
   * existing MCP flow uses.
   */
  redirectUri: string;
  github?: {
    clientId: string;
    clientSecret: string;
    /** Default `repo,read:user,user:email`. */
    scopes?: string[];
  };
  githubEnterprise?: {
    /** Hostname only (no scheme), e.g. `ghe.example.com`. */
    host: string;
    clientId: string;
    clientSecret: string;
    scopes?: string[];
  };
}

const DEFAULT_GITHUB_SCOPES = ["repo", "read:user", "user:email"];

function githubApp(cfg: NonNullable<OAuthAppsConfig["github"]>): OAuthApp {
  return {
    id: "github",
    displayName: "GitHub",
    description: "Connect github.com so agents can call the GitHub API on your behalf.",
    provider: {
      id: "github",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      scopes: cfg.scopes ?? DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: "github",
      hostPattern: "api.github.com",
    },
  };
}

function gheApp(cfg: NonNullable<OAuthAppsConfig["githubEnterprise"]>): OAuthApp {
  // GHE hosts the OAuth endpoints on the same host as the web UI, but its
  // API lives at `<host>/api/v3` for older deploys and `api.<host>` for
  // newer ones. We default to the path-prefix shape; that's what survives
  // the dynamic-forward-proxy + Host-header round-trip on the Envoy path
  // and what most enterprise installs still serve.
  const host = cfg.host;
  return {
    id: "github-enterprise",
    displayName: "GitHub Enterprise",
    description: `Connect ${host} so agents can call the GitHub Enterprise API on your behalf.`,
    provider: {
      id: "github-enterprise",
      authorizationUrl: `https://${host}/login/oauth/authorize`,
      tokenEndpoint: `https://${host}/login/oauth/access_token`,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      scopes: cfg.scopes ?? DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      // One GHE per deployment for now — the connection key is stable and
      // shared by every owner, but tokens land in per-`(owner, connection)`
      // Secrets so isolation is preserved. Multi-host GHE would key on
      // `ghe-<host-hash>` instead.
      connectionKey: "github-enterprise",
      hostPattern: host,
    },
  };
}

export interface OAuthAppRegistry {
  list(): OAuthApp[];
  listSummaries(): OAuthAppSummary[];
  get(id: string): OAuthApp | null;
}

export function createOAuthAppRegistry(cfg: OAuthAppsConfig): OAuthAppRegistry {
  const apps: OAuthApp[] = [];
  if (cfg.github) apps.push(githubApp(cfg.github));
  if (cfg.githubEnterprise) apps.push(gheApp(cfg.githubEnterprise));
  const byId = new Map(apps.map((a) => [a.id, a]));
  return {
    list: () => apps.slice(),
    listSummaries: () =>
      apps.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        description: a.description,
        hostPattern: a.flow.hostPattern,
      })),
    get: (id) => byId.get(id) ?? null,
  };
}
