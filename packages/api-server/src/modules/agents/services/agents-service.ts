import {
  isProtectedAgentEnvName,
  type AgentsService,
  type CreateAgentInput,
  type UpdateAgentInput,
  type EnvVar,
  type TemplateSpec,
} from "api-server-api";
import type { AgentsRepository } from "./../infrastructure/agents-repository.js";
import { assembleSpecFromTemplate, assembleSpecFromImage } from "../domain/spec-assembly.js";

/**
 * Returns a new env list where any platform-managed entries (e.g. PORT) are
 * taken from `current` rather than `incoming`, preventing clients from
 * clobbering template-owned envs.
 */
function preserveProtectedEnvs(current: EnvVar[], incoming: EnvVar[]): EnvVar[] {
  const preserved = current.filter((e) => isProtectedAgentEnvName(e.name));
  const user = incoming.filter((e) => !isProtectedAgentEnvName(e.name));
  return [...preserved, ...user];
}

export function createAgentsService(deps: {
  repo: AgentsRepository;
  owner: string;
  agentHome: string;
  readTemplateSpec: (id: string) => Promise<{ spec: TemplateSpec; isOwned: boolean } | null>;
}): AgentsService {
  return {
    list: () => deps.repo.list(deps.owner),
    get: (id) => deps.repo.get(id, deps.owner),

    async create(input: CreateAgentInput) {
      let spec: Record<string, unknown>;
      let templateId: string | undefined;
      if (input.templateId) {
        const tmpl = await deps.readTemplateSpec(input.templateId);
        if (!tmpl || tmpl.isOwned) throw new Error(`Template "${input.templateId}" not found`);
        spec = assembleSpecFromTemplate(input.name, tmpl.spec, {
          description: input.description,
        });
        templateId = input.templateId;
      } else {
        spec = assembleSpecFromImage(
          input.name,
          { image: input.image, description: input.description },
          deps.agentHome,
        );
      }
      // Append caller-supplied extras (e.g. envMappings from granted app
      // connections). `preserveProtectedEnvs` ensures PORT is always sourced
      // from the template/defaults, no matter what the caller sends.
      if (input.env?.length) {
        const base = (spec.env as EnvVar[] | undefined) ?? [];
        spec.env = preserveProtectedEnvs(base, [...base, ...input.env]);
      }
      return deps.repo.create(spec, deps.owner, templateId);
    },

    async update(input: UpdateAgentInput) {
      let env = input.env;
      if (env !== undefined) {
        const current = await deps.repo.get(input.id, deps.owner);
        env = preserveProtectedEnvs(current?.spec.env ?? [], env);
      }
      return deps.repo.updateSpec(input.id, deps.owner, {
        name: input.name,
        description: input.description,
        env,
      });
    },

    delete: (id) => deps.repo.delete(id, deps.owner),
  };
}
