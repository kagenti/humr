import type { GhEnterpriseHost } from "./gh-enterprise-bus.js";

/**
 * Shape of one entry in OneCLI's `GET /api/connections` response.
 * Kept local to avoid a wider port import; we only need a few fields.
 */
interface RawConnection {
  provider: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Extract host from `metadata.baseUrl`. Mirrors the gateway's parser
 * (apps.rs:347-352): strip `https://`, strip port, leave bare hostname.
 */
export function extractHost(metadata: Record<string, unknown> | null | undefined): string | undefined {
  if (!metadata) return undefined;
  const raw = metadata["baseUrl"];
  if (typeof raw !== "string") return undefined;
  const noScheme = raw.startsWith("https://") ? raw.slice("https://".length) : raw;
  const host = noScheme.split(":")[0]?.split("/")[0];
  return host && host.length > 0 ? host : undefined;
}

/**
 * Pick a username for `gh auth status`'s display column. github-oauth.ts
 * stores `metadata.username = user.login` after the OAuth exchange; we fall
 * back through the other common identifier fields and finally omit the field.
 */
export function pickUsername(metadata: Record<string, unknown> | null | undefined): string | undefined {
  if (!metadata) return undefined;
  for (const key of ["username", "login", "name"]) {
    const v = metadata[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Map raw OneCLI connections to the SSE event payload shape, keeping only
 * github-enterprise rows that resolve a valid host. Deterministic order
 * (sorted by host, then by id as a tiebreaker for two grants to the same
 * host) so the encoded payload is stable across reconnects.
 *
 * Logs a warning for github-enterprise rows whose `metadata.baseUrl` is
 * malformed — they're skipped silently from the sidecar's perspective, but
 * the operator gets a breadcrumb to debug a misconfigured connection.
 */
export function toGhEnterpriseHosts(
  connections: (RawConnection & { id?: string })[],
  log: (msg: string) => void = (m) => console.warn(m),
): GhEnterpriseHost[] {
  const out: (GhEnterpriseHost & { _id?: string })[] = [];
  for (const c of connections) {
    if (c.provider !== "github-enterprise") continue;
    const host = extractHost(c.metadata);
    if (!host) {
      log(`github-enterprise connection ${c.id ?? "?"}: missing or malformed metadata.baseUrl; skipped`);
      continue;
    }
    const username = pickUsername(c.metadata);
    out.push({ host, ...(username ? { username } : {}), _id: c.id });
  }
  out.sort((a, b) => a.host.localeCompare(b.host) || (a._id ?? "").localeCompare(b._id ?? ""));
  return out.map(({ _id, ...rest }) => rest);
}
