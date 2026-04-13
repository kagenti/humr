import type {
  Agent,
  AgentsService,
  CreateAgentInput,
  UpdateAgentInput,
  TemplateSpec,
} from "api-server-api";
import { assembleSpecFromTemplate, assembleSpecFromImage } from "../domain/spec-assembly.js";

export function createAgentsService(deps: {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  create: (spec: Record<string, unknown>, templateId?: string) => Promise<Agent>;
  update: (id: string, patch: { description?: string; mcpServers?: Record<string, unknown> }) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
  readTemplateSpec: (id: string) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
}): AgentsService {
  return {
    list: deps.list,
    get: deps.get,

    async create(input: CreateAgentInput) {
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) throw new Error(`Template "${input.templateId}" not found`);
        const spec = assembleSpecFromTemplate(input.name, tmpl.spec, {
          description: input.description,
          mcpServers: input.mcpServers,
        });
        return deps.create(spec, input.templateId);
      }
      const spec = assembleSpecFromImage(input.name, {
        image: input.image,
        description: input.description,
        mcpServers: input.mcpServers,
      });
      return deps.create(spec);
    },

    async update(input: UpdateAgentInput) {
      return deps.update(input.id, {
        description: input.description,
        mcpServers: input.mcpServers,
      });
    },

    delete: deps.delete,
  };
}
