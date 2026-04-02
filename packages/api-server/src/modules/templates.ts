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

export interface TemplateSpec {
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
  spec: TemplateSpec;
}

export interface TemplatesContext {
  list: () => Promise<Template[]>;
  get: (name: string) => Promise<Template | null>;
  create: (input: CreateTemplateInput) => Promise<Template>;
  delete: (name: string) => Promise<void>;
}
