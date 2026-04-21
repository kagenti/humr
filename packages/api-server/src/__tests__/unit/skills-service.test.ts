import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Agent, Skill, SkillRef, SkillSource } from "api-server-api";
import { createSkillsService } from "../../modules/skills/services/skills-service.js";
import {
  SkillSourceProtectedError,
  type SkillsRepository,
} from "../../modules/skills/infrastructure/skills-repository.js";
import type { InstancesRepository } from "../../modules/agents/infrastructure/instances-repository.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { AgentRuntimeSkillsClient } from "../../modules/skills/infrastructure/agent-runtime-client.js";
import type { InfraInstance } from "../../modules/agents/domain/instance-assembly.js";

const OWNER = "user-1";
const INSTANCE_ID = "inst-42";
const AGENT_ID = "agent-1";
const SOURCE: SkillSource = {
  id: "skill-src-abc",
  name: "Apocohq",
  gitUrl: "https://github.com/apocohq/skills",
};

function makeRepo(overrides: Partial<SkillsRepository> = {}): SkillsRepository {
  return {
    list: async () => [SOURCE],
    get: async (id, owner) => (id === SOURCE.id && owner === OWNER ? SOURCE : null),
    create: async (input) => ({ id: "skill-src-new", name: input.name, gitUrl: input.gitUrl }),
    delete: async () => {},
    ...overrides,
  };
}

function makeInfraInstance(overrides: Partial<InfraInstance> = {}): InfraInstance {
  return {
    id: INSTANCE_ID,
    name: "inst",
    agentId: AGENT_ID,
    desiredState: "running",
    currentState: "running",
    podReady: true,
    skills: [],
    ...overrides,
  };
}

function makeAgent(skillPaths?: string[]): Agent {
  return {
    id: AGENT_ID,
    name: "a",
    spec: {
      version: "humr.ai/v1",
      name: "a",
      image: "x",
      ...(skillPaths ? { skillPaths } : {}),
    },
  };
}

interface Env {
  instancesGet: ReturnType<typeof vi.fn>;
  instancesUpdate: ReturnType<typeof vi.fn>;
  agentsGet: ReturnType<typeof vi.fn>;
  runtimeInstall: ReturnType<typeof vi.fn>;
  runtimeUninstall: ReturnType<typeof vi.fn>;
  getAgentToken: ReturnType<typeof vi.fn>;
  svc: ReturnType<typeof createSkillsService>;
}

function makeEnv(opts: {
  instance?: InfraInstance | null;
  agent?: Agent | null;
  runtimeError?: Error;
  runtimeUninstallError?: Error;
} = {}): Env {
  const infra = opts.instance ?? makeInfraInstance();
  const instancesGet = vi.fn().mockResolvedValue(infra);
  const instancesUpdate = vi.fn().mockImplementation(async () => infra);
  const agentsGet = vi.fn().mockResolvedValue(opts.agent ?? makeAgent(["/home/agent/.claude/skills/"]));
  const runtimeInstall = opts.runtimeError
    ? vi.fn().mockRejectedValue(opts.runtimeError)
    : vi.fn().mockResolvedValue(undefined);
  const runtimeUninstall = opts.runtimeUninstallError
    ? vi.fn().mockRejectedValue(opts.runtimeUninstallError)
    : vi.fn().mockResolvedValue(undefined);

  const instancesRepo = { get: instancesGet, updateSpec: instancesUpdate } as unknown as InstancesRepository;
  const agentsRepo = { get: agentsGet } as unknown as AgentsRepository;
  const runtimeClient: AgentRuntimeSkillsClient = {
    install: runtimeInstall,
    uninstall: runtimeUninstall,
    listLocal: vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([]),
  };

  const getAgentToken = vi.fn<(agentId: string) => Promise<string>>().mockResolvedValue("agent-token-xyz");

  const svc = createSkillsService({
    repo: makeRepo(),
    instancesRepo,
    agentsRepo,
    runtimeClient,
    getAgentToken,
    owner: OWNER,
    scanSource: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
  });

  return { instancesGet, instancesUpdate, agentsGet, runtimeInstall, runtimeUninstall, getAgentToken, svc };
}

const installInput = {
  instanceId: INSTANCE_ID,
  source: SOURCE.gitUrl,
  name: "adr",
  version: "sha-v1",
};

describe("skills-service install", () => {
  it("calls agent-runtime, then upserts skills on the instance spec", async () => {
    const env = makeEnv();
    const result = await env.svc.installSkill(installInput);

    expect(env.runtimeInstall).toHaveBeenCalledTimes(1);
    expect(env.runtimeInstall).toHaveBeenCalledWith(INSTANCE_ID, "agent-token-xyz", {
      source: SOURCE.gitUrl,
      name: "adr",
      version: "sha-v1",
      skillPaths: ["/home/agent/.claude/skills/"],
    });
    expect(env.instancesUpdate).toHaveBeenCalledTimes(1);
    expect(env.instancesUpdate).toHaveBeenCalledWith(INSTANCE_ID, OWNER, {
      skills: [{ source: SOURCE.gitUrl, name: "adr", version: "sha-v1" }],
    });
    expect(result).toEqual([{ source: SOURCE.gitUrl, name: "adr", version: "sha-v1" }]);
  });

  it("replaces an existing entry with the same (source,name) rather than duplicating", async () => {
    const existing: SkillRef[] = [
      { source: SOURCE.gitUrl, name: "adr", version: "old-sha" },
      { source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" },
    ];
    const env = makeEnv({ instance: makeInfraInstance({ skills: existing }) });

    await env.svc.installSkill(installInput);

    expect(env.instancesUpdate).toHaveBeenCalledWith(INSTANCE_ID, OWNER, {
      skills: [
        { source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" },
        { source: SOURCE.gitUrl, name: "adr", version: "sha-v1" },
      ],
    });
  });

  it("falls back to the default skillPath when the agent has none", async () => {
    const env = makeEnv({ agent: makeAgent() });
    await env.svc.installSkill(installInput);
    expect(env.runtimeInstall).toHaveBeenCalledWith(INSTANCE_ID, "agent-token-xyz", expect.objectContaining({
      skillPaths: ["/home/agent/.agents/skills/"],
    }));
  });

  it("throws PRECONDITION_FAILED when the instance is not running, without calling agent-runtime", async () => {
    const env = makeEnv({ instance: makeInfraInstance({ currentState: "hibernated" }) });
    await expect(env.svc.installSkill(installInput)).rejects.toThrow(TRPCError);
    await expect(env.svc.installSkill(installInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(env.runtimeInstall).not.toHaveBeenCalled();
    expect(env.instancesUpdate).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the instance is missing", async () => {
    const env = makeEnv({ instance: undefined });
    env.instancesGet.mockResolvedValueOnce(null);
    await expect(env.svc.installSkill(installInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(env.runtimeInstall).not.toHaveBeenCalled();
    expect(env.instancesUpdate).not.toHaveBeenCalled();
  });

  it("does not mutate the spec when agent-runtime fails", async () => {
    const env = makeEnv({ runtimeError: new Error("agent-runtime unreachable") });
    await expect(env.svc.installSkill(installInput)).rejects.toThrow(/unreachable/);
    expect(env.instancesUpdate).not.toHaveBeenCalled();
  });
});

describe("skills-service uninstall", () => {
  it("calls agent-runtime, then removes the matching (source,name) from spec", async () => {
    const existing: SkillRef[] = [
      { source: SOURCE.gitUrl, name: "adr", version: "sha-v1" },
      { source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" },
    ];
    const env = makeEnv({ instance: makeInfraInstance({ skills: existing }) });

    const result = await env.svc.uninstallSkill({
      instanceId: INSTANCE_ID,
      source: SOURCE.gitUrl,
      name: "adr",
    });

    expect(env.runtimeUninstall).toHaveBeenCalledWith(INSTANCE_ID, "agent-token-xyz", {
      name: "adr",
      skillPaths: ["/home/agent/.claude/skills/"],
    });
    expect(env.instancesUpdate).toHaveBeenCalledWith(INSTANCE_ID, OWNER, {
      skills: [{ source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" }],
    });
    expect(result).toEqual([{ source: SOURCE.gitUrl, name: "grill-me", version: "other-sha" }]);
  });

  it("leaves spec alone when agent-runtime fails", async () => {
    const env = makeEnv({ runtimeUninstallError: new Error("boom") });
    await expect(
      env.svc.uninstallSkill({ instanceId: INSTANCE_ID, source: SOURCE.gitUrl, name: "adr" }),
    ).rejects.toThrow(/boom/);
    expect(env.instancesUpdate).not.toHaveBeenCalled();
  });
});

describe("skills-service listLocal", () => {
  it("returns local skills from agent-runtime minus those already tracked by name", async () => {
    const runtimeListLocal = vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([
      { name: "adr", description: "", skillPath: "/home/agent/.claude/skills/" },
      { name: "my-draft", description: "work in progress", skillPath: "/home/agent/.claude/skills/" },
    ]);
    const env = makeEnv({
      instance: makeInfraInstance({
        skills: [{ source: "https://x/x", name: "adr", version: "sha" }],
      }),
    });
    // Overwrite with a runtimeClient that has our listLocal mock.
    const svc = createSkillsService({
      repo: makeRepo(),
      instancesRepo: { get: env.instancesGet, updateSpec: env.instancesUpdate } as unknown as InstancesRepository,
      agentsRepo: { get: env.agentsGet } as unknown as AgentsRepository,
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
      },
      getAgentToken: async () => "agent-token-xyz",
      owner: OWNER,
      scanSource: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    const result = await svc.listLocal(INSTANCE_ID);

    expect(runtimeListLocal).toHaveBeenCalledWith(
      INSTANCE_ID,
      "agent-token-xyz",
      ["/home/agent/.claude/skills/"],
    );
    // "adr" collides with a tracked skill → hidden. "my-draft" is purely local → returned.
    expect(result).toEqual([
      { name: "my-draft", description: "work in progress", skillPath: "/home/agent/.claude/skills/" },
    ]);
  });

  it("returns empty when the instance is not running", async () => {
    const runtimeListLocal = vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([]);
    const instancesGet = vi.fn().mockResolvedValue(
      makeInfraInstance({ currentState: "hibernated", desiredState: "hibernated" }),
    );
    const svc = createSkillsService({
      repo: makeRepo(),
      instancesRepo: { get: instancesGet, updateSpec: vi.fn() } as unknown as InstancesRepository,
      agentsRepo: { get: vi.fn() } as unknown as AgentsRepository,
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
      },
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    expect(await svc.listLocal(INSTANCE_ID)).toEqual([]);
    expect(runtimeListLocal).not.toHaveBeenCalled();
  });

  it("returns empty when the instance is missing", async () => {
    const instancesGet = vi.fn().mockResolvedValue(null);
    const runtimeListLocal = vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([]);
    const svc = createSkillsService({
      repo: makeRepo(),
      instancesRepo: { get: instancesGet, updateSpec: vi.fn() } as unknown as InstancesRepository,
      agentsRepo: { get: vi.fn() } as unknown as AgentsRepository,
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
      },
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    expect(await svc.listLocal("ghost")).toEqual([]);
    expect(runtimeListLocal).not.toHaveBeenCalled();
  });
});

describe("skills-service deleteSource", () => {
  it("translates SkillSourceProtectedError to a FORBIDDEN tRPC error", async () => {
    const del = vi.fn().mockRejectedValue(new SkillSourceProtectedError());
    const svc = createSkillsService({
      repo: { ...makeRepo(), delete: del },
      instancesRepo: {} as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "agent-token-xyz",
      owner: OWNER,
      scanSource: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await expect(svc.deleteSource("skill-src-seed")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
