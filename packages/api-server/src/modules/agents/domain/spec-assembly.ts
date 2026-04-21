import type { EnvVar, TemplateSpec } from "api-server-api";
import { isProtectedAgentEnvName, SPEC_VERSION } from "api-server-api";
import { DEFAULT_TEMPLATE_SPEC } from "./defaults.js";

/**
 * Merge base env (from template) with extras provided at create-time (e.g.
 * envMappings contributed by granted app connections). Protected names (PORT)
 * are always sourced from `base`; extras with the same non-protected name as a
 * base entry override the base value.
 */
function mergeEnv(base: EnvVar[] = [], extra: EnvVar[] = []): EnvVar[] {
  if (extra.length === 0) return base;
  const extraNames = new Set(extra.map((e) => e.name));
  const kept = base.filter(
    (e) => isProtectedAgentEnvName(e.name) || !extraNames.has(e.name),
  );
  const safeExtra = extra.filter((e) => !isProtectedAgentEnvName(e.name));
  return [...kept, ...safeExtra];
}

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string; env?: EnvVar[] },
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: tmplSpec.image,
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    init: tmplSpec.init,
    env: mergeEnv(tmplSpec.env, opts.env),
    resources: tmplSpec.resources,
    securityContext: tmplSpec.securityContext,
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: { image?: string; description?: string; env?: EnvVar[] },
): Record<string, unknown> {
  const defaultEnv = (DEFAULT_TEMPLATE_SPEC as { env?: EnvVar[] }).env;
  return {
    name,
    version: SPEC_VERSION,
    image: opts.image,
    description: opts.description,
    ...DEFAULT_TEMPLATE_SPEC,
    env: mergeEnv(defaultEnv, opts.env),
  };
}
