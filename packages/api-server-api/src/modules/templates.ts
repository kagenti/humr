export interface Mount {
  path: string;
  persist: boolean;
}

export interface EnvVar {
  name: string;
  value: string;
}

export interface Resources {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}

export interface SecurityContext {
  runAsNonRoot?: boolean;
  readOnlyRootFilesystem?: boolean;
}

export const SPEC_VERSION = "humr.ai/v1";

export interface MCPServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
}

export interface TemplateSpec {
  version: string;
  image: string;
  description?: string;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  securityContext?: SecurityContext;
  mcpServers?: Record<string, MCPServerConfig>;
}

export interface Template {
  id: string;
  name: string;
  spec: TemplateSpec;
}

export interface CreateTemplateInput {
  name: string;
  image: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig>;
}

export interface TemplatesContext {
  list: () => Promise<Template[]>;
  get: (id: string) => Promise<Template | null>;
  create: (input: CreateTemplateInput) => Promise<Template>;
  delete: (id: string) => Promise<void>;
}
