import type { Template, CreateTemplateInput } from "../domain/types.js";

export interface TemplatesContext {
  list: () => Promise<Template[]>;
  get: (name: string) => Promise<Template | null>;
  create: (input: CreateTemplateInput) => Promise<Template>;
  delete: (name: string) => Promise<void>;
}
