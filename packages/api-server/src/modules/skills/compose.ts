import type * as k8s from "@kubernetes/client-node";
import type { Skill, SkillsService } from "api-server-api";
import { createAgentsRepository } from "../agents/infrastructure/agents-repository.js";
import { createInstancesRepository } from "../agents/infrastructure/instances-repository.js";
import { createK8sClient } from "../agents/infrastructure/k8s.js";
import { createAgentRuntimeSkillsClient } from "./infrastructure/agent-runtime-client.js";
import { createAgentTokenResolver } from "./infrastructure/agent-token.js";
import { createSkillsRepository } from "./infrastructure/skills-repository.js";
import { scanSource } from "./infrastructure/skill-scanner.js";
import { createSkillsService } from "./services/skills-service.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  skills: Skill[];
  expiresAt: number;
}

/**
 * Cache shared across all users, keyed by gitUrl. A skill source returns the
 * same catalogue regardless of who's asking, so there's no owner-scoping.
 * The service is re-composed per request (context-scoped), so the cache must
 * live at module scope to persist across requests.
 */
const sharedScanCache = new Map<string, CacheEntry>();

async function scanWithCache(gitUrl: string): Promise<Skill[]> {
  const hit = sharedScanCache.get(gitUrl);
  if (hit && hit.expiresAt > Date.now()) {
    process.stderr.write(`[skills] cache hit: ${gitUrl}\n`);
    return hit.skills;
  }
  process.stderr.write(`[skills] cache miss: ${gitUrl}\n`);
  const skills = await scanSource(gitUrl);
  sharedScanCache.set(gitUrl, { skills, expiresAt: Date.now() + CACHE_TTL_MS });
  return skills;
}

export function composeSkillsModule(
  api: k8s.CoreV1Api,
  namespace: string,
  owner: string,
): SkillsService {
  const k8s = createK8sClient(api, namespace);
  return createSkillsService({
    repo: createSkillsRepository(k8s),
    instancesRepo: createInstancesRepository(k8s),
    agentsRepo: createAgentsRepository(k8s),
    runtimeClient: createAgentRuntimeSkillsClient(namespace),
    getAgentToken: createAgentTokenResolver(k8s),
    owner,
    scanSource: scanWithCache,
  });
}
