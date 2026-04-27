import type { ConnectorFile, FileFragment } from "../types.js";

/**
 * Strip scheme and port from `metadata.baseUrl`, mirroring the gateway's
 * parser (see context/onecli/apps/gateway/src/apps.rs `extract_host_from_base_url`).
 */
function extractHost(metadata: Record<string, unknown> | null | undefined): string | undefined {
  if (!metadata) return undefined;
  const raw = metadata["baseUrl"];
  if (typeof raw !== "string") return undefined;
  const noScheme = raw.startsWith("https://") ? raw.slice("https://".length) : raw;
  const host = noScheme.split(":")[0]?.split("/")[0];
  return host && host.length > 0 ? host : undefined;
}

/**
 * `gh auth status` only displays the user — the actual auth uses the proxied
 * sentinel token. We pick the OAuth login (`metadata.username`) by default and
 * fall back through `login` and `name` so older connection records keep working.
 */
function pickUsername(metadata: Record<string, unknown> | null | undefined): string | undefined {
  if (!metadata) return undefined;
  for (const key of ["username", "login", "name"]) {
    const v = metadata[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export const githubEnterpriseHosts: ConnectorFile = {
  provider: "github-enterprise",
  path: "/home/agent/.config/gh/hosts.yml",
  mode: "yaml-fill-if-missing",
  render(connection): FileFragment | null {
    const host = extractHost(connection.metadata);
    if (!host) {
      console.warn(
        `github-enterprise connection ${connection.id ?? "?"}: missing or malformed metadata.baseUrl; skipped`,
      );
      return null;
    }
    const username = pickUsername(connection.metadata);
    return {
      [host]: {
        oauth_token: "humr:sentinel",
        git_protocol: "https",
        ...(username ? { user: username } : {}),
      },
    };
  },
};

// Re-exported only so tests can hit the helpers directly when needed.
export const _internals = { extractHost, pickUsername };
