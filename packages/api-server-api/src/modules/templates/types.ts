import type { EnvVar } from "../shared.js";

export interface Mount {
  path: string;
  persist: boolean;
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
  id: string;
  name: string;
  spec: TemplateSpec;
}

export interface TemplatesService {
  list: () => Promise<Template[]>;
  get: (id: string) => Promise<Template | null>;
}
