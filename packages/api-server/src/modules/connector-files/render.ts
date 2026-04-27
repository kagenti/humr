import type { ConnectorFile, FileSpec, RawConnection } from "./types.js";

/**
 * Render the registry against a set of connections and return one `FileSpec`
 * per managed path. Pure function; deterministic ordering (paths sorted
 * alphabetically, fragments grouped by path in registry order).
 */
export function renderFiles(
  connections: RawConnection[],
  registry: readonly ConnectorFile[],
): FileSpec[] {
  const byPath = new Map<string, FileSpec>();

  for (const entry of registry) {
    const matching = connections.filter((c) => c.provider === entry.provider);
    if (matching.length === 0) continue;
    let spec = byPath.get(entry.path);
    if (!spec) {
      spec = { path: entry.path, mode: entry.mode, fragments: [] };
      byPath.set(entry.path, spec);
    } else if (spec.mode !== entry.mode) {
      // Two registry entries declaring the same path with different modes is
      // a programmer error — surface loud rather than silently picking one.
      throw new Error(
        `connector-files registry conflict at ${entry.path}: mode ${spec.mode} vs ${entry.mode}`,
      );
    }
    for (const conn of matching) {
      const fragment = entry.render(conn);
      if (fragment) spec.fragments.push(fragment);
    }
  }

  return [...byPath.values()]
    .filter((s) => s.fragments.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}
