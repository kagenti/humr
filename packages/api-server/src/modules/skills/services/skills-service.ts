import { TRPCError } from "@trpc/server";
import type {
  CreateSkillSourceInput,
  InstallSkillInput,
  Skill,
  SkillRef,
  SkillsService,
  UninstallSkillInput,
} from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { InstancesRepository } from "../../agents/infrastructure/instances-repository.js";
import {
  SkillSourceProtectedError,
  type SkillsRepository,
} from "../infrastructure/skills-repository.js";
import type { AgentRuntimeSkillsClient } from "../infrastructure/agent-runtime-client.js";

const DEFAULT_SKILL_PATHS = ["/home/agent/.agents/skills/"];

export interface SkillsServiceDeps {
  repo: SkillsRepository;
  instancesRepo: InstancesRepository;
  agentsRepo: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  getAgentToken: (agentId: string) => Promise<string>;
  owner: string;
  scanSource: (gitUrl: string) => Promise<Skill[]>;
}

async function resolveSkillPaths(
  deps: SkillsServiceDeps,
  agentId: string,
): Promise<string[]> {
  const agent = await deps.agentsRepo.get(agentId, deps.owner);
  const paths = agent?.spec.skillPaths;
  return paths && paths.length > 0 ? paths : DEFAULT_SKILL_PATHS;
}

async function loadRunningInstance(deps: SkillsServiceDeps, instanceId: string) {
  const infra = await deps.instancesRepo.get(instanceId, deps.owner);
  if (!infra) throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
  if (infra.currentState !== "running") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `instance is ${infra.currentState ?? "not running"}; wake it before installing skills`,
    });
  }
  return infra;
}

function upsertSkill(current: SkillRef[], next: SkillRef): SkillRef[] {
  const filtered = current.filter((s) => !(s.source === next.source && s.name === next.name));
  return [...filtered, next];
}

function removeSkill(current: SkillRef[], key: { source: string; name: string }): SkillRef[] {
  return current.filter((s) => !(s.source === key.source && s.name === key.name));
}

export function createSkillsService(deps: SkillsServiceDeps): SkillsService {
  return {
    listSources: () => deps.repo.list(deps.owner),
    getSource: (id) => deps.repo.get(id, deps.owner),
    createSource: (input: CreateSkillSourceInput) => deps.repo.create(input, deps.owner),
    async deleteSource(id) {
      try {
        await deps.repo.delete(id, deps.owner);
      } catch (err) {
        if (err instanceof SkillSourceProtectedError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
    },

    async listSkills(sourceId: string) {
      const src = await deps.repo.get(sourceId, deps.owner);
      if (!src) return [];
      return deps.scanSource(src.gitUrl);
    },

    async installSkill(input: InstallSkillInput) {
      const infra = await loadRunningInstance(deps, input.instanceId);
      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);

      await deps.runtimeClient.install(input.instanceId, token, {
        source: input.source,
        name: input.name,
        version: input.version,
        skillPaths,
      });

      const updated = upsertSkill(infra.skills, {
        source: input.source,
        name: input.name,
        version: input.version,
      });
      await deps.instancesRepo.updateSpec(input.instanceId, deps.owner, { skills: updated });
      return updated;
    },

    async uninstallSkill(input: UninstallSkillInput) {
      const infra = await loadRunningInstance(deps, input.instanceId);
      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);

      await deps.runtimeClient.uninstall(input.instanceId, token, {
        name: input.name,
        skillPaths,
      });

      const updated = removeSkill(infra.skills, { source: input.source, name: input.name });
      await deps.instancesRepo.updateSpec(input.instanceId, deps.owner, { skills: updated });
      return updated;
    },
  };
}
