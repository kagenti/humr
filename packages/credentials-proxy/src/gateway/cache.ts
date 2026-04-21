export interface InjectionRule {
  secretId: string;
  hostPattern: RegExp;
  headerName: string;
  headerValue: string;
}

export interface CacheSnapshot {
  /** Rules ordered by host-pattern specificity (longest source string wins on ties). */
  rules: InjectionRule[];
  loadedAt: Date;
}

/**
 * Find the first rule whose hostPattern matches. Rules should be pre-sorted
 * most-specific-first at build time so the natural iteration order wins.
 */
export function findRule(snapshot: CacheSnapshot, host: string): InjectionRule | undefined {
  for (const r of snapshot.rules) {
    if (r.hostPattern.test(host)) return r;
  }
  return undefined;
}

/**
 * Compile a raw host-pattern string from the DB into a regex. Accepts either a
 * glob (`*.github.com`) or a literal hostname. Globs are converted to anchored
 * regex with `*` → `[^.]+` so `*.github.com` matches `api.github.com` but not
 * `a.b.github.com`, matching how curl/openssl interpret wildcard certs.
 */
export function compileHostPattern(raw: string): RegExp {
  const escaped = raw
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^.]+");
  return new RegExp(`^${escaped}$`, "i");
}
