import { TRPCError } from "@trpc/server";
import type { PublishSkillInput, PublishSkillResult } from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { InstancesRepository } from "../../agents/infrastructure/instances-repository.js";
import {
  AgentRuntimeUpstreamError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import { detectHost } from "../infrastructure/git-host.js";
import type { SkillsRepository } from "../infrastructure/skills-repository.js";

const DEFAULT_SKILL_PATHS = ["/home/agent/.agents/skills/"];

export interface PublishServiceDeps {
  owner: string;
  sources: SkillsRepository;
  instances: InstancesRepository;
  agents: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  getAgentToken: (agentId: string) => Promise<string>;
}

/**
 * Publish orchestrator — thin proxy. Validates that the user owns the
 * instance + source and the instance is running, then delegates everything
 * else to agent-runtime (which is network-wired to OneCLI's MITM so the
 * GitHub token swap happens server-side).
 *
 * Upstream OneCLI errors (app_not_connected / access_restricted) get
 * re-thrown as tRPC errors with the `connect_url` / `manage_url` carried
 * along in `message` so the UI can parse them.
 */
export async function publishSkill(
  deps: PublishServiceDeps,
  input: PublishSkillInput,
): Promise<PublishSkillResult> {
  const infra = await deps.instances.get(input.instanceId, deps.owner);
  if (!infra) throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
  if (infra.currentState !== "running") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `instance is ${infra.currentState ?? "not running"}; start it before publishing`,
    });
  }

  const source = await deps.sources.get(input.sourceId, deps.owner);
  if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "skill source not found" });

  const host = detectHost(source.gitUrl);
  if (!host) {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: `publishing to ${source.gitUrl} isn't supported yet (only GitHub)`,
    });
  }

  const agent = await deps.agents.get(infra.agentId, deps.owner);
  const skillPaths = agent?.spec.skillPaths?.length
    ? agent.spec.skillPaths
    : DEFAULT_SKILL_PATHS;
  const token = await deps.getAgentToken(infra.agentId);

  try {
    return await deps.runtimeClient.publish(input.instanceId, token, {
      name: input.name,
      skillPaths,
      owner: host.owner,
      repo: host.repo,
      title: input.title?.trim() || `Add ${input.name} skill`,
      body: input.body?.trim() || `Published from Humr.\n\n**Skill:** \`${input.name}\``,
    });
  } catch (err) {
    if (err instanceof AgentRuntimeUpstreamError) {
      throw upstreamToTrpc(err);
    }
    throw err;
  }
}

/**
 * Translate an OneCLI gateway error (relayed by agent-runtime as HTTP 502
 * with a `.upstream` envelope) into a tRPC error the UI can act on.
 *
 * We encode the `connect_url` / `manage_url` into the message as a
 * `humr-cta:<url>` prefix segment that the client can split back out. Keeps
 * the server → client contract simple (no tRPC data extension needed).
 */
function upstreamToTrpc(err: AgentRuntimeUpstreamError): TRPCError {
  const { status, body } = err.upstream;
  const message = body?.message ?? err.message;
  const cta = body?.connect_url ?? body?.manage_url;
  const encoded = cta ? `${message}\nhumr-cta:${cta}` : message;

  if (body?.error === "app_not_connected" || body?.error === "access_restricted") {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: encoded });
  }
  if (status === 403) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: `GitHub rejected the request (${message}). Reconnect GitHub in OneCLI with the repo scope.`,
    });
  }
  if (status === 404) {
    return new TRPCError({ code: "NOT_FOUND", message: `GitHub: ${message}` });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `GitHub ${status}: ${message}`,
  });
}
