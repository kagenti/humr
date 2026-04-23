import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Agent, Skill, SkillRef, SkillSource, Template } from "api-server-api";
import {
  createSkillsService,
  templateSourceId,
} from "../../modules/skills/services/skills-service.js";
import {
  SkillSourceProtectedError,
  type SkillsRepository,
} from "../../modules/skills/infrastructure/skills-repository.js";
import { PublicArchiveNotFoundError } from "../../modules/skills/infrastructure/public-archive-scanner.js";
import type { InstancesRepository } from "../../modules/agents/infrastructure/instances-repository.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { TemplatesRepository } from "../../modules/agents/infrastructure/templates-repository.js";
import type { AgentRuntimeSkillsClient } from "../../modules/skills/infrastructure/agent-runtime-client.js";
import type { InfraInstance } from "../../modules/agents/domain/instance-assembly.js";

function emptyTemplatesRepo(): TemplatesRepository {
  return {
    list: async () => [],
    get: async () => null,
    readSpec: async () => null,
  };
}

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
    publishes: [],
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
    : vi.fn().mockResolvedValue({ contentHash: "runtime-computed-hash" });
  const runtimeUninstall = opts.runtimeUninstallError
    ? vi.fn().mockRejectedValue(opts.runtimeUninstallError)
    : vi.fn().mockResolvedValue(undefined);

  const instancesRepo = { get: instancesGet, updateSpec: instancesUpdate } as unknown as InstancesRepository;
  const agentsRepo = { get: agentsGet } as unknown as AgentsRepository;
  const runtimeClient: AgentRuntimeSkillsClient = {
    install: runtimeInstall,
    uninstall: runtimeUninstall,
    listLocal: vi.fn<AgentRuntimeSkillsClient["listLocal"]>().mockResolvedValue([]),
    readLocal: vi.fn<AgentRuntimeSkillsClient["readLocal"]>().mockResolvedValue([]),
    publish: vi.fn<AgentRuntimeSkillsClient["publish"]>().mockResolvedValue({ prUrl: "x", branch: "y" }),
    scan: vi.fn<AgentRuntimeSkillsClient["scan"]>().mockResolvedValue([]),
  };

  const getAgentToken = vi.fn<(agentId: string) => Promise<string>>().mockResolvedValue("agent-token-xyz");

  const svc = createSkillsService({
    repo: makeRepo(),
    instancesRepo,
    agentsRepo,
    templatesRepo: emptyTemplatesRepo(),
    runtimeClient,
    getAgentToken,
    owner: OWNER,
    scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
    invalidateScan: vi.fn(),
    scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
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
      skills: [{ source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "runtime-computed-hash" }],
    });
    expect(result).toEqual([{ source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "runtime-computed-hash" }]);
  });

  it("prefers the UI-scan-provided contentHash over the agent-runtime-computed one", async () => {
    const env = makeEnv();
    await env.svc.installSkill({ ...installInput, contentHash: "from-scan" });
    expect(env.instancesUpdate).toHaveBeenCalledWith(INSTANCE_ID, OWNER, {
      skills: [{ source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "from-scan" }],
    });
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
        { source: SOURCE.gitUrl, name: "adr", version: "sha-v1", contentHash: "runtime-computed-hash" },
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

  it("rescues a legacy agent (no skillPaths on spec) by reading the template's skillPaths", async () => {
    // Agent ConfigMap written before spec-assembly was fixed: templateId is
    // set but the spec itself is missing skillPaths. The service should
    // consult the template instead of silently using the hardcoded default.
    const legacyAgent: Agent = {
      id: AGENT_ID,
      name: "a",
      templateId: "claude-code",
      spec: { version: "humr.ai/v1", name: "a", image: "x" },
    };
    const template: Template = {
      id: "claude-code",
      name: "claude-code",
      spec: {
        version: "humr.ai/v1",
        image: "x",
        skillPaths: ["/home/agent/.claude/skills/"],
      },
    };
    const env = makeEnv({ agent: legacyAgent });
    // Swap in a templates repo that returns the template by id.
    const svc = createSkillsService({
      repo: makeRepo(),
      instancesRepo: { get: env.instancesGet, updateSpec: env.instancesUpdate } as unknown as InstancesRepository,
      agentsRepo: { get: env.agentsGet } as unknown as AgentsRepository,
      templatesRepo: {
        list: async () => [],
        get: async (id) => (id === template.id ? template : null),
        readSpec: async () => null,
      },
      runtimeClient: {
        install: env.runtimeInstall,
        uninstall: env.runtimeUninstall,
        listLocal: vi.fn(),
        readLocal: vi.fn(),
        publish: vi.fn(),
        scan: vi.fn(),
      },
      getAgentToken: async () => "agent-token-xyz",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await svc.installSkill(installInput);

    expect(env.runtimeInstall).toHaveBeenCalledWith(INSTANCE_ID, "agent-token-xyz", expect.objectContaining({
      skillPaths: ["/home/agent/.claude/skills/"],
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
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
        readLocal: vi.fn(),
        publish: vi.fn(),
        scan: vi.fn(),
      },
      getAgentToken: async () => "agent-token-xyz",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
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
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
        readLocal: vi.fn(),
        publish: vi.fn(),
        scan: vi.fn(),
      },
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
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
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: runtimeListLocal,
        readLocal: vi.fn(),
        publish: vi.fn(),
        scan: vi.fn(),
      },
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    expect(await svc.listLocal("ghost")).toEqual([]);
    expect(runtimeListLocal).not.toHaveBeenCalled();
  });
});

describe("skills-service listSkills routing", () => {
  type RuntimeScan = AgentRuntimeSkillsClient["scan"];
  type PublicScan = (gitUrl: string) => Promise<Skill[]>;
  function buildSvc(opts: {
    runtimeScan: ReturnType<typeof vi.fn<RuntimeScan>>;
    publicScan: ReturnType<typeof vi.fn<PublicScan>>;
    source?: { id: string; name: string; gitUrl: string };
    instance?: InfraInstance | null;
  }) {
    const src = opts.source ?? SOURCE;
    const instance = opts.instance === undefined ? makeInfraInstance() : opts.instance;
    const runtimeClient: AgentRuntimeSkillsClient = {
      install: vi.fn(),
      uninstall: vi.fn(),
      listLocal: vi.fn(),
      readLocal: vi.fn(),
      publish: vi.fn(),
      scan: opts.runtimeScan,
    };
    // The scan cache wrapper simply calls through to whatever scanner is
    // passed in — tests don't exercise caching directly.
    const scanCache = async (gitUrl: string, scanner: (u: string) => Promise<Skill[]>) =>
      scanner(gitUrl);

    return createSkillsService({
      repo: { ...makeRepo(), get: async (id) => (id === src.id ? src : null) },
      instancesRepo: {
        get: vi.fn().mockResolvedValue(instance),
      } as unknown as InstancesRepository,
      agentsRepo: {
        get: vi.fn().mockResolvedValue({
          id: AGENT_ID,
          name: "a",
          spec: { skillPaths: ["/home/agent/.claude/skills/"] },
        }),
      } as unknown as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient,
      getAgentToken: async () => "token",
      owner: OWNER,
      scanSource: scanCache,
      invalidateScan: vi.fn(),
      scanPublic: opts.publicScan,
    });
  }

  it("uses the public archive path when it succeeds (no agent-runtime call)", async () => {
    const publicScan = vi.fn<PublicScan>().mockResolvedValue([
      { source: SOURCE.gitUrl, name: "adr", description: "", version: "sha", contentHash: "h" },
    ]);
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({ publicScan, runtimeScan });

    const result = await svc.listSkills(SOURCE.id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalledWith(SOURCE.gitUrl);
    expect(runtimeScan).not.toHaveBeenCalled();
    expect(result).toEqual([
      { source: SOURCE.gitUrl, name: "adr", description: "", version: "sha", contentHash: "h" },
    ]);
  });

  it("falls back to agent-runtime on PublicArchiveNotFoundError (private repo)", async () => {
    const publicScan = vi.fn<PublicScan>().mockRejectedValue(new PublicArchiveNotFoundError(SOURCE.gitUrl));
    const runtimeScan = vi.fn<RuntimeScan>().mockResolvedValue([
      { source: SOURCE.gitUrl, name: "secret", description: "priv", version: "sha", contentHash: "h" },
    ]);
    const svc = buildSvc({ publicScan, runtimeScan });

    const result = await svc.listSkills(SOURCE.id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalled();
    expect(runtimeScan).toHaveBeenCalledWith(INSTANCE_ID, "token", SOURCE.gitUrl);
    expect(result[0].name).toBe("secret");
  });

  it("does not require a running instance for a public scan", async () => {
    const publicScan = vi.fn<PublicScan>().mockResolvedValue([]);
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({
      publicScan,
      runtimeScan,
      instance: makeInfraInstance({ currentState: "hibernated" }),
    });

    await svc.listSkills(SOURCE.id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalled();
    expect(runtimeScan).not.toHaveBeenCalled();
  });

  it("throws PRECONDITION_FAILED when falling back to agent-runtime requires a running instance but it isn't", async () => {
    const publicScan = vi.fn<PublicScan>().mockRejectedValue(new PublicArchiveNotFoundError(SOURCE.gitUrl));
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({
      publicScan,
      runtimeScan,
      instance: makeInfraInstance({ currentState: "hibernated" }),
    });

    await expect(svc.listSkills(SOURCE.id, INSTANCE_ID)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(runtimeScan).not.toHaveBeenCalled();
  });

  it("rethrows non-404 public errors without calling agent-runtime", async () => {
    const publicScan = vi.fn<PublicScan>().mockRejectedValue(new Error("network blew up"));
    const runtimeScan = vi.fn<RuntimeScan>();
    const svc = buildSvc({ publicScan, runtimeScan });

    await expect(svc.listSkills(SOURCE.id, INSTANCE_ID)).rejects.toThrow(/network blew up/);
    expect(runtimeScan).not.toHaveBeenCalled();
  });

  it("scans a template:* source id by resolving it via the templates repo (regression: was 404ing against the K8s CM lookup)", async () => {
    const templateId = "tmpl-gw";
    const templateName = "Google Workspace";
    const templateUrl = "https://github.com/anthropics/google-workspace-skills";
    const publicScan = vi.fn<PublicScan>().mockResolvedValue([
      { source: templateUrl, name: "drive", description: "", version: "sha", contentHash: "h" },
    ]);
    const runtimeScan = vi.fn<RuntimeScan>();
    const scanCache = async (gitUrl: string, scanner: (u: string) => Promise<Skill[]>) =>
      scanner(gitUrl);
    const templatesRepo: TemplatesRepository = {
      list: async () => [],
      get: async (id) =>
        id === templateId
          ? {
              id: templateId,
              name: templateName,
              spec: {
                version: "humr.ai/v1",
                image: "x",
                skillSources: [{ name: "GW Skills", gitUrl: templateUrl }],
              },
            }
          : null,
      readSpec: async () => null,
    };
    const svc = createSkillsService({
      // The real repo never sees template:* ids — fail loudly if it does.
      repo: {
        ...makeRepo(),
        get: async (id) => {
          if (id.startsWith("template:")) throw new Error("template:* must not hit the CM repo");
          return null;
        },
      },
      instancesRepo: {
        get: vi.fn().mockResolvedValue(makeInfraInstance()),
      } as unknown as InstancesRepository,
      agentsRepo: {
        get: vi.fn().mockResolvedValue({
          id: AGENT_ID,
          name: "a",
          spec: { skillPaths: ["/home/agent/.claude/skills/"] },
        }),
      } as unknown as AgentsRepository,
      templatesRepo,
      runtimeClient: {
        install: vi.fn(),
        uninstall: vi.fn(),
        listLocal: vi.fn(),
        readLocal: vi.fn(),
        publish: vi.fn(),
        scan: runtimeScan,
      },
      getAgentToken: async () => "token",
      owner: OWNER,
      scanSource: scanCache,
      invalidateScan: vi.fn(),
      scanPublic: publicScan,
    });

    const id = templateSourceId(templateId, templateUrl);
    const result = await svc.listSkills(id, INSTANCE_ID);

    expect(publicScan).toHaveBeenCalledWith(templateUrl);
    expect(runtimeScan).not.toHaveBeenCalled();
    expect(result[0].name).toBe("drive");
  });
});

describe("skills-service getState (ghost reconciliation)", () => {
  function build(opts: {
    instance?: InfraInstance | null;
    local?: Array<{ name: string; description: string; skillPath: string }>;
  }) {
    const infra = opts.instance === undefined ? makeInfraInstance() : opts.instance;
    const instancesGet = vi.fn().mockResolvedValue(infra);
    const instancesUpdate = vi.fn().mockResolvedValue(null);
    const runtimeClient: AgentRuntimeSkillsClient = {
      install: vi.fn(),
      uninstall: vi.fn(),
      listLocal: vi.fn().mockResolvedValue(opts.local ?? []),
      readLocal: vi.fn(),
      publish: vi.fn(),
      scan: vi.fn(),
    };
    const svc = createSkillsService({
      repo: makeRepo(),
      instancesRepo: {
        get: instancesGet,
        updateSpec: instancesUpdate,
      } as unknown as InstancesRepository,
      agentsRepo: {
        get: vi.fn().mockResolvedValue({
          id: AGENT_ID,
          name: "a",
          spec: { skillPaths: ["/home/agent/.claude/skills/"] },
        }),
      } as unknown as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });
    return { svc, instancesGet, instancesUpdate, runtimeClient };
  }

  it("drops SkillRefs whose dirs are missing on disk and persists the cleanup", async () => {
    const infra = makeInfraInstance({
      skills: [
        { source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" },
        { source: SOURCE.gitUrl, name: "ghost", version: "v1", contentHash: "h1" },
      ],
    });
    const { svc, instancesUpdate } = build({
      instance: infra,
      local: [{ name: "adr", description: "", skillPath: "/home/agent/.claude/skills/" }],
    });

    const state = await svc.getState(INSTANCE_ID);

    expect(state.installed).toEqual([
      { source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" },
    ]);
    expect(state.standalone).toEqual([]);
    expect(instancesUpdate).toHaveBeenCalledWith(INSTANCE_ID, OWNER, {
      skills: [{ source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" }],
    });
  });

  it("returns on-disk skills not tracked in spec.skills as standalone", async () => {
    const infra = makeInfraInstance({
      skills: [{ source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" }],
    });
    const { svc, instancesUpdate } = build({
      instance: infra,
      local: [
        { name: "adr", description: "tracked", skillPath: "/home/agent/.claude/skills/" },
        { name: "my-draft", description: "new one", skillPath: "/home/agent/.claude/skills/" },
      ],
    });

    const state = await svc.getState(INSTANCE_ID);

    expect(state.installed.map((s) => s.name)).toEqual(["adr"]);
    expect(state.standalone.map((s) => s.name)).toEqual(["my-draft"]);
    // Nothing to clean up, so no update call.
    expect(instancesUpdate).not.toHaveBeenCalled();
  });

  it("does not reconcile when the instance isn't running (safe during restart)", async () => {
    const infra = makeInfraInstance({
      currentState: "hibernated",
      skills: [{ source: SOURCE.gitUrl, name: "adr", version: "v1", contentHash: "h1" }],
    });
    const { svc, instancesUpdate, runtimeClient } = build({ instance: infra, local: [] });

    const state = await svc.getState(INSTANCE_ID);

    // Return spec.skills as-is; we can't see the filesystem so we can't
    // tell if the ref is really a ghost.
    expect(state.installed).toEqual(infra.skills);
    expect(state.standalone).toEqual([]);
    expect(runtimeClient.listLocal).not.toHaveBeenCalled();
    expect(instancesUpdate).not.toHaveBeenCalled();
  });

  it("returns empty when the instance is missing", async () => {
    const { svc } = build({ instance: null });
    const state = await svc.getState("nope");
    expect(state).toEqual({ installed: [], standalone: [], publishes: [] });
  });
});

describe("skills-service deleteSource", () => {
  it("translates SkillSourceProtectedError to a FORBIDDEN tRPC error", async () => {
    const del = vi.fn().mockRejectedValue(new SkillSourceProtectedError());
    const svc = createSkillsService({
      repo: { ...makeRepo(), delete: del },
      instancesRepo: {} as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "agent-token-xyz",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await expect(svc.deleteSource("skill-src-seed")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects deletion of synthesised template:* ids with FORBIDDEN", async () => {
    const del = vi.fn();
    const svc = createSkillsService({
      repo: { ...makeRepo(), delete: del },
      instancesRepo: {} as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await expect(svc.deleteSource("template:tmpl-x:abcdef012345")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // The repo is never called for synthesised ids — there's nothing to delete.
    expect(del).not.toHaveBeenCalled();
  });

  it("scrubs instance.skills entries that reference the deleted source's gitUrl", async () => {
    const otherUrl = "https://github.com/other/skills";
    const instA = makeInfraInstance({
      id: "inst-A",
      skills: [
        { source: SOURCE.gitUrl, name: "adr", version: "v1" },
        { source: otherUrl, name: "other", version: "v1" },
      ],
    });
    const instB = makeInfraInstance({
      id: "inst-B",
      skills: [{ source: SOURCE.gitUrl, name: "grill-me", version: "v2" }],
    });
    const instancesList = vi.fn().mockResolvedValue([instA, instB]);
    const instancesUpdate = vi.fn().mockResolvedValue(null);
    const del = vi.fn().mockResolvedValue(undefined);

    const svc = createSkillsService({
      repo: { ...makeRepo(), delete: del },
      instancesRepo: {
        list: instancesList,
        updateSpec: instancesUpdate,
      } as unknown as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await svc.deleteSource(SOURCE.id);

    expect(del).toHaveBeenCalledWith(SOURCE.id, OWNER);
    // inst-A: the source-matched adr entry is dropped, other stays.
    expect(instancesUpdate).toHaveBeenCalledWith("inst-A", OWNER, {
      skills: [{ source: otherUrl, name: "other", version: "v1" }],
    });
    // inst-B: the only entry matched, list is emptied.
    expect(instancesUpdate).toHaveBeenCalledWith("inst-B", OWNER, { skills: [] });
  });

  it("skips the scrub when no instance references the deleted source", async () => {
    const instA = makeInfraInstance({
      id: "inst-A",
      skills: [{ source: "https://github.com/other/skills", name: "x", version: "v" }],
    });
    const instancesList = vi.fn().mockResolvedValue([instA]);
    const instancesUpdate = vi.fn().mockResolvedValue(null);

    const svc = createSkillsService({
      repo: makeRepo(),
      instancesRepo: {
        list: instancesList,
        updateSpec: instancesUpdate,
      } as unknown as InstancesRepository,
      agentsRepo: {} as AgentsRepository,
      templatesRepo: emptyTemplatesRepo(),
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    await svc.deleteSource(SOURCE.id);
    expect(instancesUpdate).not.toHaveBeenCalled();
  });
});

describe("skills-service listSources", () => {
  const TEMPLATE_ID = "tmpl-gw";
  const TEMPLATE_NAME = "Google Workspace";
  const TEMPLATE_URL = "https://github.com/anthropics/google-workspace-skills";

  /** Compose a svc whose repos answer with the given user + template data. */
  function build(opts: {
    userSources?: SkillSource[];
    template?: Template | null;
    templateId?: string;
  }) {
    const userSources = opts.userSources ?? [];
    const template = opts.template === undefined ? null : opts.template;
    const templateId = opts.templateId ?? (template?.id ?? null);

    const repo: SkillsRepository = {
      ...makeRepo(),
      list: async () => userSources,
    };

    const instancesRepo = {
      get: vi.fn().mockResolvedValue(makeInfraInstance()),
    } as unknown as InstancesRepository;

    const agentsRepo = {
      get: vi.fn().mockResolvedValue({
        id: AGENT_ID,
        name: "a",
        templateId: templateId ?? undefined,
        spec: { version: "humr.ai/v1", name: "a", image: "x" },
      } as Agent),
    } as unknown as AgentsRepository;

    const templatesGet = vi.fn().mockImplementation(async (id: string) =>
      template && id === template.id ? template : null,
    );

    const templatesRepo: TemplatesRepository = {
      list: async () => [],
      get: templatesGet,
      readSpec: async () => null,
    };

    const svc = createSkillsService({
      repo,
      instancesRepo,
      agentsRepo,
      templatesRepo,
      runtimeClient: {} as AgentRuntimeSkillsClient,
      getAgentToken: async () => "t",
      owner: OWNER,
      scanSource: vi.fn<(u: string, s: (u: string) => Promise<Skill[]>) => Promise<Skill[]>>().mockResolvedValue([]),
      invalidateScan: vi.fn(),
      scanPublic: vi.fn<(u: string) => Promise<Skill[]>>().mockResolvedValue([]),
    });

    return { svc, templatesGet };
  }

  const TEMPLATE: Template = {
    id: TEMPLATE_ID,
    name: TEMPLATE_NAME,
    spec: {
      version: "humr.ai/v1",
      image: "x",
      skillSources: [
        { name: "GW Skills", gitUrl: TEMPLATE_URL },
      ],
    },
  };

  it("returns user + system sources only when no instanceId is provided", async () => {
    const { svc, templatesGet } = build({
      userSources: [{ id: "u-1", name: "Mine", gitUrl: "https://github.com/me/skills" }],
      template: TEMPLATE,
    });

    const out = await svc.listSources();
    expect(out.map((s) => s.gitUrl)).toEqual(["https://github.com/me/skills"]);
    expect(templatesGet).not.toHaveBeenCalled();
  });

  it("merges user + template sources with synthesised template ids and the Agent badge tag", async () => {
    const { svc } = build({
      userSources: [{ id: "u-1", name: "Mine", gitUrl: "https://github.com/me/skills" }],
      template: TEMPLATE,
    });

    const out = await svc.listSources(INSTANCE_ID);

    // Order: user → template → platform. Here: one user, one template.
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "u-1", name: "Mine" });
    expect(out[1]).toMatchObject({
      id: templateSourceId(TEMPLATE_ID, TEMPLATE_URL),
      name: "GW Skills",
      gitUrl: TEMPLATE_URL,
      fromTemplate: { templateId: TEMPLATE_ID, templateName: TEMPLATE_NAME },
    });
    expect(out[1].system).toBeUndefined();
  });

  it("dedupes by gitUrl, with user winning over template for the same URL", async () => {
    const { svc } = build({
      userSources: [
        {
          id: "u-shadow",
          name: "My Workspace Skills",
          gitUrl: TEMPLATE_URL,
        },
      ],
      template: TEMPLATE,
    });

    const out = await svc.listSources(INSTANCE_ID);

    // Only one row: the user entry (first in the dedupe priority order).
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("u-shadow");
    expect(out[0].fromTemplate).toBeUndefined();
  });

  it("falls back to user + system when the agent has no templateId", async () => {
    const { svc, templatesGet } = build({
      userSources: [{ id: "u-1", name: "Mine", gitUrl: "https://github.com/me/skills" }],
      template: null,
      templateId: undefined,
    });

    const out = await svc.listSources(INSTANCE_ID);

    expect(out.map((s) => s.id)).toEqual(["u-1"]);
    expect(templatesGet).not.toHaveBeenCalled();
  });

  it("sorts user → template → platform, alphabetical within each group", async () => {
    const userSources: SkillSource[] = [
      { id: "u-b", name: "Bravo", gitUrl: "https://github.com/u/b" },
      { id: "u-a", name: "alpha", gitUrl: "https://github.com/u/a" },
      // A system-tagged entry that listSources() returns from the repo.
      { id: "sys-c", name: "Cluster Ops", gitUrl: "https://github.com/sys/c", system: true },
    ];
    const template: Template = {
      id: TEMPLATE_ID,
      name: TEMPLATE_NAME,
      spec: {
        version: "humr.ai/v1",
        image: "x",
        skillSources: [
          { name: "Zeta", gitUrl: "https://github.com/t/z" },
          { name: "Alpha Team", gitUrl: "https://github.com/t/a" },
        ],
      },
    };
    const { svc } = build({ userSources, template });

    const out = await svc.listSources(INSTANCE_ID);

    expect(out.map((s) => s.name)).toEqual([
      // User group — yours first (alphabetical, case-insensitive)
      "alpha",
      "Bravo",
      // Template (Agent) group
      "Alpha Team",
      "Zeta",
      // Platform group — least personal, last
      "Cluster Ops",
    ]);
  });

  it("resolves a synthesised template:* id via getSource (not a K8s ConfigMap read)", async () => {
    const { svc } = build({ template: TEMPLATE });
    const id = templateSourceId(TEMPLATE_ID, TEMPLATE_URL);

    const got = await svc.getSource(id);

    expect(got).toMatchObject({
      id,
      name: "GW Skills",
      gitUrl: TEMPLATE_URL,
      fromTemplate: { templateId: TEMPLATE_ID, templateName: TEMPLATE_NAME },
      canPublish: true,
    });
  });

  it("returns null from getSource when the template or the seed no longer exists", async () => {
    const { svc } = build({ template: null });
    const got = await svc.getSource("template:ghost:abcdef012345");
    expect(got).toBeNull();
  });
});
