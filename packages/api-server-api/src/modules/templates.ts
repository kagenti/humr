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
  name: string;
  spec: TemplateSpec;
}

export interface CreateTemplateInput {
  name: string;
  image: string;
  description?: string;
}

export interface TemplatesContext {
  list: () => Promise<Template[]>;
  get: (name: string) => Promise<Template | null>;
  create: (input: CreateTemplateInput) => Promise<Template>;
  delete: (name: string) => Promise<void>;
}
