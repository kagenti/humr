import type { TemplateSpec } from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import { DEFAULT_TEMPLATE_SPEC } from "./defaults.js";

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string },
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: tmplSpec.image,
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    init: tmplSpec.init,
    env: tmplSpec.env,
    resources: tmplSpec.resources,
    securityContext: tmplSpec.securityContext,
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: { image?: string; description?: string },
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: opts.image,
    description: opts.description,
    ...DEFAULT_TEMPLATE_SPEC,
  };
}
