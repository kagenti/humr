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
}

export interface Template {
  id: string;
  name: string;
  spec: TemplateSpec;
}

export interface TemplatesContext {
  list: () => Promise<Template[]>;
  get: (id: string) => Promise<Template | null>;
}
