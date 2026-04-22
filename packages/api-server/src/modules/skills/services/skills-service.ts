import { TRPCError } from "@trpc/server";
import type {
  CreateSkillSourceInput,
  InstallSkillInput,
  LocalSkill,
  PublishSkillInput,
  PublishSkillResult,
  Skill,
  SkillRef,
  SkillSource,
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
import { detectHost } from "../infrastructure/git-host.js";
import { publishSkill as runPublishSkill } from "./publish-service.js";

const DEFAULT_SKILL_PATHS = ["/home/agent/.agents/skills/"];

export interface SkillsServiceDeps {
  repo: SkillsRepository;
  instancesRepo: InstancesRepository;
  agentsRepo: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  getAgentToken: (agentId: string) => Promise<string>;
  owner: string;
  scanSource: (gitUrl: string) => Promise<Skill[]>;
  invalidateScan: (gitUrl: string) => void;
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

/**
 * canPublish is a soft signal: "the publish infrastructure knows how to
 * target this host." True when the gitUrl parses as a GitHub URL — that's
 * the only host our publish flow supports today. Authentication/authorization
 * (is the user Connected in OneCLI? is this agent granted access?) is not
 * preflighted here; any failure surfaces at publish time with a precise CTA
 * from OneCLI's gateway. Cheaper + harder to get stale than a cluster call.
 */
function enrichSources(sources: SkillSource[]): SkillSource[] {
  return sources.map((s) => (detectHost(s.gitUrl) ? { ...s, canPublish: true } : s));
}

export function createSkillsService(deps: SkillsServiceDeps): SkillsService {
  return {
    async listSources() {
      const sources = await deps.repo.list(deps.owner);
      return enrichSources(sources);
    },
    async getSource(id) {
      const s = await deps.repo.get(id, deps.owner);
      if (!s) return null;
      const [enriched] = enrichSources([s]);
      return enriched;
    },
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

    async publishSkill(input: PublishSkillInput): Promise<PublishSkillResult> {
      const result = await runPublishSkill(
        {
          owner: deps.owner,
          sources: deps.repo,
          instances: deps.instancesRepo,
          agents: deps.agentsRepo,
          runtimeClient: deps.runtimeClient,
          getAgentToken: deps.getAgentToken,
        },
        input,
      );
      // Drop the scan cache for this source so the next listSkills reflects
      // the merged PR (whenever that happens — we don't wait, we just stop
      // serving a stale snapshot).
      const source = await deps.repo.get(input.sourceId, deps.owner);
      if (source) deps.invalidateScan(source.gitUrl);
      return result;
    },

    async refreshSource(id: string): Promise<void> {
      const source = await deps.repo.get(id, deps.owner);
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "skill source not found" });
      deps.invalidateScan(source.gitUrl);
    },

    async listLocal(instanceId: string): Promise<LocalSkill[]> {
      const infra = await deps.instancesRepo.get(instanceId, deps.owner);
      if (!infra) return [];
      // No filesystem to read when the pod isn't running.
      if (infra.currentState !== "running") return [];
      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);
      const all = await deps.runtimeClient.listLocal(instanceId, token, skillPaths);
      // Subtract anything already tracked as installed-from-remote (by directory
      // name). Matches behavior that the remote-installed entry is the canonical
      // one when names collide.
      const tracked = new Set(infra.skills.map((s) => s.name));
      return all.filter((s) => !tracked.has(s.name));
    },
  };
}
