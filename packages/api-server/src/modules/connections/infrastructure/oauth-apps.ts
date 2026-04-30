/**
 * Static descriptors for the OAuth apps Humr knows how to drive — GitHub.com,
 * GitHub Enterprise. Each descriptor declares the inputs the user must
 * supply at connect time (their own OAuth client id + secret, plus the GHE
 * host where applicable) and a `build` function that turns those inputs
 * into the `OAuthFlowProvider` + `OAuthFlowMetadata` the engine needs.
 *
 * Client credentials live with the user, not in chart config — every user
 * registers their own OAuth app at the provider against the platform's
 * callback URL. A future slice may layer in a public default `client_id` or
 * RFC 7591 dynamic client registration as a fallback for providers that
 * support it; for now the user supplies the credentials each connect.
 */
import { z } from "zod";

import {
  type OAuthFlowMetadata,
  type OAuthFlowProvider,
} from "./oauth-engine.js";

export type OAuthAppId = "github" | "github-enterprise";

export interface OAuthAppInputField {
  name: string;
  label: string;
  /** Render as a password input — never echo secret values back to the UI. */
  secret?: boolean;
  placeholder?: string;
  /** Short hint shown beneath the field. */
  helper?: string;
}

export interface OAuthAppDescriptor {
  id: OAuthAppId;
  displayName: string;
  description: string;
  /**
   * Stable storage key for connections of this app. Currently 1:1 with `id`;
   * preserved as a separate field so the listing/delete code doesn't have
   * to know that.
   */
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
   *  carries the host; for GitHub.com, the static "GitHub". */
  connectionDisplayName: string;
}

const DEFAULT_GITHUB_SCOPES = ["repo", "read:user", "user:email"];

const DESCRIPTORS: Record<OAuthAppId, OAuthAppDescriptor> = {
  github: {
    id: "github",
    displayName: "GitHub",
    description: "Connect github.com so agents can call the GitHub API on your behalf.",
    connectionKey: "github",
    registrationUrl: "https://github.com/settings/applications/new",
    inputs: [
      {
        name: "clientId",
        label: "Client ID",
        placeholder: "Iv1.…",
        helper: "From the OAuth app you registered on github.com.",
      },
      {
        name: "clientSecret",
        label: "Client secret",
        secret: true,
      },
    ],
  },
  "github-enterprise": {
    id: "github-enterprise",
    displayName: "GitHub Enterprise",
    description: "Connect a GitHub Enterprise host so agents can call its API on your behalf.",
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
};

const githubInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

const gheInputSchema = z.object({
  host: z
    .string()
    .min(1, "Host is required")
    // RFC 1123 subdomain — same shape K8s names accept, applied here so the
    // host slots cleanly into K8s metadata + Envoy SNI matching.
    .regex(
      /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/,
      "Host must be a valid DNS hostname (no scheme).",
    ),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

export type GithubInput = z.infer<typeof githubInputSchema>;
export type GheInput = z.infer<typeof gheInputSchema>;

export interface OAuthAppRegistry {
  list(): OAuthAppDescriptor[];
  get(id: string): OAuthAppDescriptor | null;
  /**
   * Validate user-supplied form input against the app's schema and produce
   * the engine inputs. Throws on validation failure — caller maps to a 400.
   */
  build(id: OAuthAppId, rawInput: unknown): BuiltOAuthApp;
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
    flow: { connectionKey: "github", hostPattern: "api.github.com" },
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
    },
    connectionDisplayName: `GitHub Enterprise (${host})`,
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
      throw new Error(`unknown app id: ${id as string}`);
    },
  };
}
