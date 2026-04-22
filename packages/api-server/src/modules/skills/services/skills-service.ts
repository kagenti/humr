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
  SkillsState,
  UninstallSkillInput,
} from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { InstancesRepository } from "../../agents/infrastructure/instances-repository.js";
import {
  SkillSourceProtectedError,
  type SkillsRepository,
} from "../infrastructure/skills-repository.js";
import {
  AgentRuntimeUpstreamError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import { detectHost } from "../infrastructure/git-host.js";
import { PublicArchiveNotFoundError } from "../infrastructure/public-archive-scanner.js";
import { publishSkill as runPublishSkill } from "./publish-service.js";
import { upstreamToTrpc } from "../infrastructure/upstream-to-trpc.js";

const DEFAULT_SKILL_PATHS = ["/home/agent/.agents/skills/"];

export interface SkillsServiceDeps {
  repo: SkillsRepository;
  instancesRepo: InstancesRepository;
  agentsRepo: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  getAgentToken: (agentId: string) => Promise<string>;
  owner: string;
  /** Scan via the provided scanner with a shared TTL cache. The cache key is
   *  the gitUrl alone — results are user-independent. */
  scanSource: (gitUrl: string, scanner: (gitUrl: string) => Promise<Skill[]>) => Promise<Skill[]>;
  invalidateScan: (gitUrl: string) => void;
  /** Scan a public GitHub repo directly from the api-server pod. Throws
   *  `PublicArchiveNotFoundError` when the archive endpoint returns 404 —
   *  signal to the caller to fall back to the agent-runtime path for
   *  private-repo auth (if the instance is running). */
  scanPublic: (gitUrl: string) => Promise<Skill[]>;
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
      // Capture the gitUrl before deletion — after delete we can't resolve
      // which installed-skill entries belonged to this source.
      const src = await deps.repo.get(id, deps.owner);
      try {
        await deps.repo.delete(id, deps.owner);
      } catch (err) {
        if (err instanceof SkillSourceProtectedError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
      // Scrub spec.skills entries that reference the now-gone source URL
      // across every instance owned by the user. Without this, re-adding a
      // source with the same URL would render its skills as already-checked
      // (the stale SkillRefs persist in the instance's spec), which is
      // confusing at best and wrong when the user has manually deleted the
      // skill files in the meantime.
      if (src) {
        const instances = await deps.instancesRepo.list(deps.owner);
        await Promise.all(
          instances.map(async (infra) => {
            const keep = infra.skills.filter((s) => s.source !== src.gitUrl);
            if (keep.length !== infra.skills.length) {
              await deps.instancesRepo.updateSpec(infra.id, deps.owner, { skills: keep });
            }
          }),
        );
      }
    },

    async listSkills(sourceId: string, instanceId: string) {
      const src = await deps.repo.get(sourceId, deps.owner);
      if (!src) return [];

      // Fast path: public GitHub repo scanned directly from api-server. This
      // works in every OneCLI state (unconfigured, not Connected, not
      // granted, fully granted) because api-server has direct internet
      // egress — it never touches OneCLI's per-agent-grant gating.
      if (detectHost(src.gitUrl)) {
        try {
          return await deps.scanSource(src.gitUrl, deps.scanPublic);
        } catch (err) {
          if (!(err instanceof PublicArchiveNotFoundError)) throw err;
          // 404 → repo is private (or nonexistent). Only the authenticated
          // agent-runtime path can distinguish those and surface a useful
          // CTA, so we fall through.
        }
      }

      // Private/authenticated path: delegate to agent-runtime inside a
      // running instance pod, which uses OneCLI's token swap.
      const infra = await deps.instancesRepo.get(instanceId, deps.owner);
      if (!infra) throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
      if (infra.currentState !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `instance is ${infra.currentState ?? "not running"}; start it before browsing private sources`,
        });
      }
      const token = await deps.getAgentToken(infra.agentId);
      try {
        return await deps.scanSource(src.gitUrl, (gitUrl) =>
          deps.runtimeClient.scan(instanceId, token, gitUrl),
        );
      } catch (err) {
        if (err instanceof AgentRuntimeUpstreamError) throw upstreamToTrpc(err);
        throw err;
      }
    },

    async installSkill(input: InstallSkillInput) {
      const infra = await loadRunningInstance(deps, input.instanceId);
      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);

      let result;
      try {
        result = await deps.runtimeClient.install(input.instanceId, token, {
          source: input.source,
          name: input.name,
          version: input.version,
          skillPaths,
        });
      } catch (err) {
        if (err instanceof AgentRuntimeUpstreamError) throw upstreamToTrpc(err);
        throw err;
      }

      // Prefer the scan-time contentHash carried by the UI (stable snapshot
      // of what the user *intended* to install). Fall back to the hash the
      // agent-runtime returned for MCP-initiated installs that skip the
      // scan round-trip.
      const contentHash = input.contentHash ?? result.contentHash;
      const updated = upsertSkill(infra.skills, {
        source: input.source,
        name: input.name,
        version: input.version,
        contentHash,
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

    /**
     * Reconciled skills view. Returns:
     *   - installed: SkillRefs whose directories still exist on the pod
     *   - standalone: on-disk skills that aren't tracked in spec.skills
     *
     * Also self-heals spec.skills: when an entry's directory is missing
     * (manual deletion, PVC wipe, etc.) it's dropped and the cleaned list
     * is persisted back. Safe because the filesystem is the source of
     * truth for "what is installed"; spec.skills is the declarative record
     * that just needs to catch up.
     *
     * When the pod isn't running we can't see the filesystem, so we return
     * spec.skills as-is (no reconciliation) and an empty standalone list.
     * This avoids wrongly dropping SkillRefs during a restart.
     */
    async getState(instanceId: string): Promise<SkillsState> {
      const infra = await deps.instancesRepo.get(instanceId, deps.owner);
      if (!infra) return { installed: [], standalone: [], publishes: [] };
      if (infra.currentState !== "running") {
        return { installed: infra.skills, standalone: [], publishes: infra.publishes };
      }

      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);
      const local = await deps.runtimeClient.listLocal(instanceId, token, skillPaths);

      const onDisk = new Set(local.map((s) => s.name));
      const installed = infra.skills.filter((ref) => onDisk.has(ref.name));

      // Persist cleanup exactly when we actually dropped something. Guarded
      // this way so we don't write on every poll; writes only happen when
      // there's a real ghost to evict.
      if (installed.length !== infra.skills.length) {
        await deps.instancesRepo.updateSpec(instanceId, deps.owner, { skills: installed });
      }

      const trackedNames = new Set(installed.map((s) => s.name));
      const standalone = local.filter((s) => !trackedNames.has(s.name));
      return { installed, standalone, publishes: infra.publishes };
    },
  };
}
