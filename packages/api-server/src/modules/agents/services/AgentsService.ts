import type {
  AgentsService,
  CreateAgentInput,
  UpdateAgentInput,
  TemplateSpec,
} from "api-server-api";
import type { AgentsRepository } from "../infrastructure/AgentsRepository.js";
import type { AgentProvisioner } from "../infrastructure/agent-provisioner.js";
import { assembleSpecFromTemplate, assembleSpecFromImage } from "../domain/spec-assembly.js";

export function createAgentsService(deps: {
  repo: AgentsRepository;
  owner: string;
  readTemplateSpec: (id: string) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
  provisioner?: AgentProvisioner;
}): AgentsService {
  return {
    list: () => deps.repo.list(deps.owner),
    get: (id) => deps.repo.get(id, deps.owner),

    async create(input: CreateAgentInput) {
      let spec: Record<string, unknown>;
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) throw new Error(`Template "${input.templateId}" not found`);
        spec = assembleSpecFromTemplate(input.name, tmpl.spec, { description: input.description });
      } else {
        spec = assembleSpecFromImage(input.name, { image: input.image, description: input.description });
      }

      const agent = await deps.repo.create(spec, deps.owner, input.templateId);

      if (deps.provisioner) {
        const secretMode = (spec as any).secretMode ?? "selective";
        await deps.provisioner.provision(agent.id, agent.name, secretMode);
      }

      return agent;
    },

    async update(input: UpdateAgentInput) {
      return deps.repo.updateSpec(input.id, deps.owner, { description: input.description });
    },

    async delete(id) {
      if (deps.provisioner) {
        await deps.provisioner.deprovision(id).catch(() => {});
      }
      await deps.repo.delete(id, deps.owner);
    },
  };
}
