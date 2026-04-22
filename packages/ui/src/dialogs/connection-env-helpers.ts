import type { AppConnectionView, EnvMapping, EnvVar } from "api-server-api";

/**
 * Env vars to append when a user grants `app`. Entries whose name already
 * exists in `envVars` are skipped so a user-set value is never clobbered by
 * the declared placeholder.
 */
export function envsToAddOnGrant(
  envVars: EnvVar[],
  app: Pick<AppConnectionView, "envMappings"> | undefined,
): EnvVar[] {
  const mappings = app?.envMappings ?? [];
  if (mappings.length === 0) return [];
  const existing = new Set(envVars.map((e) => e.name));
  return mappings
    .filter((m) => !existing.has(m.envName))
    .map((m) => ({ name: m.envName, value: m.placeholder }));
}

/**
 * Env vars after a user ungrants `app`. Entries contributed by `app` are
 * removed only when both: (a) still untouched — the stored value still equals
 * the declared placeholder — and (b) not still needed by any app in
 * `remainingGrantedApps`.
 *
 * Edited entries are preserved (user intent). Shared entries (e.g. Gmail +
 * Drive both declare GOOGLE_WORKSPACE_CLI_TOKEN) are preserved when any
 * remaining grant still declares the same envName.
 */
export function envsAfterUngrant(
  envVars: EnvVar[],
  app: Pick<AppConnectionView, "envMappings"> | undefined,
  remainingGrantedApps: Pick<AppConnectionView, "envMappings">[],
): EnvVar[] {
  const mappings: EnvMapping[] = app?.envMappings ?? [];
  if (mappings.length === 0) return envVars;
  const stillNeededNames = new Set(
    remainingGrantedApps.flatMap((a) => a.envMappings ?? []).map((m) => m.envName),
  );
  const removable = new Map(
    mappings
      .filter((m) => !stillNeededNames.has(m.envName))
      .map((m) => [m.envName, m.placeholder] as const),
  );
  if (removable.size === 0) return envVars;
  return envVars.filter(
    (e) => !(removable.has(e.name) && removable.get(e.name) === e.value),
  );
}
