import type { OnecliClient } from "../../../onecli.js";

/**
 * Normalized shape produced by this port. OneCLI exposes connections only
 * embedded in `GET /api/apps` — there is no standalone list endpoint as of
 * onecli 0.0.9. The port collapses the app+connection response into flat rows
 * for connected apps only.
 */
export interface OnecliAppConnection {
  id: string;
  provider: string;
  label?: string | null;
  status?: string | null;
  scopes?: string[] | null;
  connectedAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OnecliConnectionsPort {
  listAppConnections(): Promise<OnecliAppConnection[]>;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

/**
 * Flattens OneCLI's app-list response into connected-app rows. Tolerates the
 * two documented shapes: `[{ id, name, connection: {...} | null }, ...]` and
 * `{ apps: [...] }`.
 *
 * A row is emitted only when a per-app connection object exists with a
 * `connectedAt` timestamp. We deliberately key on `connectedAt` rather than
 * `status` — OneCLI's list endpoint strips app-level status into the top-level
 * record, so a `status` presence alone cannot distinguish "connected app" from
 * "registered but unconnected app".
 */
export function flattenApps(data: unknown): OnecliAppConnection[] {
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(asRecord(data)?.apps)
      ? (asRecord(data)!.apps as unknown[])
      : [];

  const out: OnecliAppConnection[] = [];
  for (const item of list) {
    const app = asRecord(item);
    if (!app) continue;

    const provider = asString(app.provider) ?? asString(app.id);
    if (!provider) continue;

    const connection =
      asRecord(app.connection) ?? asRecord(app.connectedService);
    if (!connection) continue;
    if (!asString(connection.connectedAt)) continue;

    const id = asString(connection.id) ?? provider;
    const label =
      asString(app.label) ??
      asString(app.name) ??
      asString(connection.label) ??
      provider;

    out.push({
      id,
      provider,
      label,
      status: asString(connection.status) ?? null,
      scopes: asStringArray(connection.scopes) ?? null,
      connectedAt: asString(connection.connectedAt) ?? null,
      metadata: asRecord(connection.metadata),
    });
  }
  return out;
}

export function createOnecliConnectionsPort(
  oc: OnecliClient,
  userJwt: string,
  userSub: string,
): OnecliConnectionsPort {
  return {
    async listAppConnections() {
      const res = await oc.onecliFetch(userJwt, userSub, "/api/apps");
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OneCLI GET /api/apps: ${res.status} ${body}`);
      }
      const data = (await res.json()) as unknown;
      return flattenApps(data);
    },
  };
}
