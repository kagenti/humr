import type { TemplateSpec } from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import { DEFAULT_TEMPLATE_SPEC } from "./defaults.js";
import type { MCPServerConfig } from "api-server-api";

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string; mcpServers?: Record<string, MCPServerConfig> },
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
    mcpServers: opts.mcpServers,
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: { image?: string; description?: string; mcpServers?: Record<string, MCPServerConfig> },
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: opts.image,
    description: opts.description,
    ...DEFAULT_TEMPLATE_SPEC,
    mcpServers: opts.mcpServers,
  };
}
