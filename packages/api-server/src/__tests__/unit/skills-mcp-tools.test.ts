import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Skill, SkillRef, SkillSource, SkillsService } from "api-server-api";
import { createSkillsToolHandlers } from "../../apps/harness-api-server/skills-tools.js";

const SESSION_INSTANCE_ID = "inst-real";
const SOURCE: SkillSource = {
  id: "skill-src-1",
  name: "Apocohq",
  gitUrl: "https://github.com/apocohq/skills",
};
const INSTALLED: SkillRef[] = [
  { source: SOURCE.gitUrl, name: "adr", version: "sha-v1" },
];

function makeSkills(overrides: Partial<SkillsService> = {}): SkillsService {
  return {
    listSources: async () => [SOURCE],
    getSource: async (id) => (id === SOURCE.id ? SOURCE : null),
    createSource: async () => SOURCE,
    deleteSource: async () => {},
    refreshSource: async () => {},
    listSkills: async () => [{ source: SOURCE.gitUrl, name: "adr", description: "", version: "sha-v1", contentHash: "hash-v1" }] as Skill[],
    installSkill: async () => INSTALLED,
    uninstallSkill: async () => [],
    listLocal: async () => [],
    getState: async () => ({ installed: [], standalone: [], publishes: [] }),
    publishSkill: async () => ({ prUrl: "https://github.com/foo/bar/pull/1", branch: "humr/publish-foo" }),
    ...overrides,
  };
}

describe("skills MCP tool handlers", () => {
  it("list_skill_sources returns the JSON-serialized source list", async () => {
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills());
    const res = await t.listSources();
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual([SOURCE]);
  });

  it("list_skill_sources forwards the session instanceId so template-seeded sources are included", async () => {
    const listSources = vi.fn<SkillsService["listSources"]>().mockResolvedValue([SOURCE]);
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills({ listSources }));
    await t.listSources();
    expect(listSources).toHaveBeenCalledTimes(1);
    expect(listSources).toHaveBeenCalledWith(SESSION_INSTANCE_ID);
  });

  it("list_skills_in_source rejects an unknown sourceId without calling listSkills", async () => {
    const listSkills = vi.fn<SkillsService["listSkills"]>().mockResolvedValue([]);
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills({
      getSource: async () => null,
      listSkills,
    }));
    const res = await t.listSkillsInSource({ sourceId: "ghost" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not found");
    expect(listSkills).not.toHaveBeenCalled();
  });

  it("install_skill passes the SESSION instanceId, not whatever the caller provides", async () => {
    const installSkill = vi.fn<SkillsService["installSkill"]>().mockResolvedValue(INSTALLED);
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills({ installSkill }));

    // Tool args intentionally omit instanceId — schema doesn't accept it —
    // but here we simulate a malicious agent: the handler takes only
    // {source, name, version}, so there's no avenue to inject a different
    // instance. We just confirm the outbound call uses the session one.
    await t.installSkill({
      source: SOURCE.gitUrl,
      name: "adr",
      version: "sha-v1",
    });

    expect(installSkill).toHaveBeenCalledTimes(1);
    expect(installSkill).toHaveBeenCalledWith({
      instanceId: SESSION_INSTANCE_ID,
      source: SOURCE.gitUrl,
      name: "adr",
      version: "sha-v1",
    });
  });

  it("install_skill surfaces PRECONDITION_FAILED with a running-instance hint", async () => {
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills({
      installSkill: async () => {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "instance is hibernated" });
      },
    }));
    const res = await t.installSkill({
      source: SOURCE.gitUrl,
      name: "adr",
      version: "sha-v1",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/running/);
  });

  it("install_skill surfaces NOT_FOUND plainly", async () => {
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills({
      installSkill: async () => {
        throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
      },
    }));
    const res = await t.installSkill({
      source: SOURCE.gitUrl,
      name: "adr",
      version: "sha-v1",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not found");
  });

  it("uninstall_skill passes session instanceId and returns a status line", async () => {
    const uninstallSkill = vi.fn<SkillsService["uninstallSkill"]>().mockResolvedValue([]);
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills({ uninstallSkill }));
    const res = await t.uninstallSkill({ source: SOURCE.gitUrl, name: "adr" });
    expect(uninstallSkill).toHaveBeenCalledWith({
      instanceId: SESSION_INSTANCE_ID,
      source: SOURCE.gitUrl,
      name: "adr",
    });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toMatch(/Uninstalled adr/);
  });

  it("install_skill unknown errors fall back to err.message", async () => {
    const t = createSkillsToolHandlers(SESSION_INSTANCE_ID, makeSkills({
      installSkill: async () => {
        throw new Error("disk full");
      },
    }));
    const res = await t.installSkill({
      source: SOURCE.gitUrl,
      name: "adr",
      version: "sha-v1",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("disk full");
  });
});
