import type {
  AgentsService,
  CreateAgentInput,
  UpdateAgentInput,
  TemplateSpec,
} from "api-server-api";
import type { AgentsRepository } from "../infrastructure/AgentsRepository.js";
import { assembleSpecFromTemplate, assembleSpecFromImage } from "../domain/spec-assembly.js";

export function createAgentsService(deps: {
  repo: AgentsRepository;
  owner: string;
  readTemplateSpec: (id: string) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
}): AgentsService {
  return {
    list: () => deps.repo.list(deps.owner),
    get: (id) => deps.repo.get(id, deps.owner),

    async create(input: CreateAgentInput) {
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) throw new Error(`Template "${input.templateId}" not found`);
        const spec = assembleSpecFromTemplate(input.name, tmpl.spec, {
          description: input.description,
          mcpServers: input.mcpServers,
        });
        return deps.repo.create(spec, deps.owner, input.templateId);
      }
      const spec = assembleSpecFromImage(input.name, {
        image: input.image,
        description: input.description,
        mcpServers: input.mcpServers,
      });
      return deps.repo.create(spec, deps.owner);
    },

    async update(input: UpdateAgentInput) {
      return deps.repo.updateSpec(input.id, deps.owner, {
        description: input.description,
        mcpServers: input.mcpServers,
      });
    },

    delete: (id) => deps.repo.delete(id, deps.owner),
  };
}
