/**
 * Static descriptors for the OAuth apps Humr knows how to drive — GitHub.com,
 * GitHub Enterprise, and a Generic app for arbitrary auth-code+PKCE
 * providers. Each descriptor declares the inputs the user must supply at
 * connect time (their own OAuth client id + secret, plus app-specific
 * fields) and a `build` function that turns those inputs into the
 * `OAuthFlowProvider` + `OAuthFlowMetadata` the engine needs.
 *
 * Client credentials live with the user, not in chart config — every user
 * registers their own OAuth app at the provider against the platform's
 * callback URL. A future slice may layer in a public default `client_id` or
 * RFC 7591 dynamic client registration as a fallback for providers that
 * support it; for now the user supplies the credentials each connect.
 *
 * Cardinality:
 * - **Single-instance** apps (github, github-enterprise) have at most one
 *   connection per user, keyed by the descriptor's `connectionKey`.
 * - **Multi-instance** apps (generic) can have many connections per user;
 *   `connectionKey` is a *prefix* and per-connection keys carry a stable
 *   suffix derived from the upstream host.
 */
import crypto from "node:crypto";
import { z } from "zod";

import {
  type OAuthFlowMetadata,
  type OAuthFlowProvider,
} from "./oauth-engine.js";

export type OAuthAppId = "github" | "github-enterprise" | "generic";

export interface OAuthAppInputField {
  name: string;
  label: string;
  /** Render as a password input — never echo secret values back to the UI. */
  secret?: boolean;
  placeholder?: string;
  /** Short hint shown beneath the field. */
  helper?: string;
}

export type OAuthAppCardinality = "single" | "multiple";

export interface OAuthAppDescriptor {
  id: OAuthAppId;
  displayName: string;
  description: string;
  /**
   * "single" — at most one connection of this app per user. `connectionKey`
   * matches exactly. "multiple" — many connections per user; `connectionKey`
   * is a prefix and per-connection keys are `<prefix>-<suffix>`.
   */
  cardinality: OAuthAppCardinality;
  /** See `cardinality`. */
  connectionKey: string;
  /** The form fields the UI renders before kicking off the OAuth dance. */
  inputs: OAuthAppInputField[];
  /**
   * Helper link surfaced near the form to walk the user through registering
   * their own OAuth app at the provider.
   */
  registrationUrl?: string;
}

export interface BuiltOAuthApp {
  provider: OAuthFlowProvider;
  flow: OAuthFlowMetadata;
  /** The display label the UI uses for this specific connection — for GHE,
   *  carries the host; for Generic, the user-supplied display name. */
  connectionDisplayName: string;
}

const DEFAULT_GITHUB_SCOPES = ["repo", "read:user", "user:email"];

const DESCRIPTORS: Record<OAuthAppId, OAuthAppDescriptor> = {
  github: {
    id: "github",
    displayName: "GitHub",
    description: "Connect github.com so agents can call the GitHub API on your behalf.",
    cardinality: "single",
    connectionKey: "github",
    registrationUrl: "https://github.com/settings/applications/new",
    inputs: [
      {
        name: "clientId",
        label: "Client ID",
        placeholder: "Iv1.…",
        helper: "From the OAuth app you registered on github.com.",
      },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
  "github-enterprise": {
    id: "github-enterprise",
    displayName: "GitHub Enterprise",
    description: "Connect a GitHub Enterprise host so agents can call its API on your behalf.",
    cardinality: "single",
    connectionKey: "github-enterprise",
    inputs: [
      {
        name: "host",
        label: "Host",
        placeholder: "ghe.example.com",
        helper: "Hostname only — no scheme or trailing slash.",
      },
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
  generic: {
    id: "generic",
    displayName: "Generic OAuth",
    description:
      "Connect any OAuth 2.1 authorization-code provider — supply the auth URL, token endpoint, and your client credentials.",
    cardinality: "multiple",
    connectionKey: "generic",
    inputs: [
      {
        name: "displayName",
        label: "Display name",
        placeholder: "e.g. Linear",
        helper: "Shown in the connections list.",
      },
      {
        name: "hostPattern",
        label: "Host",
        placeholder: "api.example.com",
        helper: "Hostname the credential injects on (no scheme).",
      },
      {
        name: "authorizationUrl",
        label: "Authorization URL",
        placeholder: "https://example.com/oauth/authorize",
      },
      {
        name: "tokenEndpoint",
        label: "Token endpoint",
        placeholder: "https://example.com/oauth/token",
      },
      {
        name: "scopes",
        label: "Scopes",
        placeholder: "read write",
        helper: "Space-separated. Leave empty to omit the scope parameter.",
      },
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
};

const githubInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

// RFC 1123 subdomain — same shape K8s names accept. Used both directly as a
// host and as input to Envoy SNI matching, so we apply it strictly here.
const HOSTNAME_RE =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

const gheInputSchema = z.object({
  host: z
    .string()
    .min(1, "Host is required")
    .regex(HOSTNAME_RE, "Host must be a valid DNS hostname (no scheme)."),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const httpsUrlSchema = z
  .string()
  .min(1)
  .refine((v) => /^https:\/\//.test(v), "Must be an https:// URL.");

const genericInputSchema = z.object({
  displayName: z.string().min(1, "Display name is required").max(80),
  hostPattern: z
    .string()
    .min(1, "Host is required")
    .regex(HOSTNAME_RE, "Host must be a valid DNS hostname (no scheme)."),
  authorizationUrl: httpsUrlSchema,
  tokenEndpoint: httpsUrlSchema,
  scopes: z.string().optional().default(""),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

export type GithubInput = z.infer<typeof githubInputSchema>;
export type GheInput = z.infer<typeof gheInputSchema>;
export type GenericInput = z.infer<typeof genericInputSchema>;

export interface OAuthAppRegistry {
  list(): OAuthAppDescriptor[];
  get(id: string): OAuthAppDescriptor | null;
  /**
   * Validate user-supplied form input against the app's schema and produce
   * the engine inputs. Throws on validation failure — caller maps to a 400.
   */
  build(id: OAuthAppId, rawInput: unknown): BuiltOAuthApp;
}

/**
 * Returns true when the given stored connection key belongs to this
 * descriptor. Single-instance apps match exactly; multi-instance apps
 * match by `<prefix>-<…>` shape.
 */
export function matchesAppConnection(
  descriptor: OAuthAppDescriptor,
  connectionKey: string,
): boolean {
  if (descriptor.cardinality === "single") {
    return connectionKey === descriptor.connectionKey;
  }
  return (
    connectionKey === descriptor.connectionKey ||
    connectionKey.startsWith(`${descriptor.connectionKey}-`)
  );
}

function buildGithub(input: GithubInput): BuiltOAuthApp {
  return {
    provider: {
      id: "github",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: "github",
      hostPattern: "api.github.com",
      displayName: "GitHub",
    },
    connectionDisplayName: "GitHub",
  };
}

function buildGhe(input: GheInput): BuiltOAuthApp {
  const host = input.host;
  return {
    provider: {
      id: "github-enterprise",
      authorizationUrl: `https://${host}/login/oauth/authorize`,
      tokenEndpoint: `https://${host}/login/oauth/access_token`,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      // Single GHE per user for now — connecting a different GHE host
      // replaces the previous one. Multi-host GHE (key on host hash) is a
      // follow-up.
      connectionKey: "github-enterprise",
      hostPattern: host,
      displayName: `GitHub Enterprise (${host})`,
    },
    connectionDisplayName: `GitHub Enterprise (${host})`,
  };
}

function genericConnectionKey(hostPattern: string): string {
  // Connection key derived from hostPattern so reconnecting the same host
  // updates the existing K8s Secret in place. Different hosts → different
  // keys → independent connections.
  const hash = crypto.createHash("sha1").update(hostPattern).digest("hex").slice(0, 16);
  return `generic-${hash}`;
}

function buildGeneric(input: GenericInput): BuiltOAuthApp {
  const scopes = input.scopes
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    provider: {
      id: "generic",
      authorizationUrl: input.authorizationUrl,
      tokenEndpoint: input.tokenEndpoint,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      ...(scopes.length > 0 ? { scopes } : {}),
      // `Accept: application/json` is a safe default — providers that don't
      // honor it return JSON anyway, and the few that fall back to
      // form-encoded are caught by the engine's lenient parser.
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: genericConnectionKey(input.hostPattern),
      hostPattern: input.hostPattern,
      displayName: input.displayName,
    },
    connectionDisplayName: input.displayName,
  };
}

export function createOAuthAppRegistry(): OAuthAppRegistry {
  return {
    list: () => Object.values(DESCRIPTORS),
    get: (id: string) =>
      Object.prototype.hasOwnProperty.call(DESCRIPTORS, id)
        ? DESCRIPTORS[id as OAuthAppId]
        : null,
    build: (id, rawInput) => {
      if (id === "github") return buildGithub(githubInputSchema.parse(rawInput));
      if (id === "github-enterprise") return buildGhe(gheInputSchema.parse(rawInput));
      if (id === "generic") return buildGeneric(genericInputSchema.parse(rawInput));
      throw new Error(`unknown app id: ${id as string}`);
    },
  };
}
