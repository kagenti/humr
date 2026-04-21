import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertAbsoluteSkillPath,
  assertSafeSkillName,
  installSkillInputSchema,
  listLocalSkills,
  resolveSkillDir,
  uninstallSkill,
  uninstallSkillInputSchema,
} from "../../modules/skills.js";

describe("assertSafeSkillName", () => {
  it("accepts a plain name", () => {
    expect(() => assertSafeSkillName("pdf")).not.toThrow();
    expect(() => assertSafeSkillName("my-skill_v2")).not.toThrow();
  });

  it("rejects path traversal and path separators", () => {
    expect(() => assertSafeSkillName("../etc/passwd")).toThrow(/invalid skill name/);
    expect(() => assertSafeSkillName("foo/bar")).toThrow(/invalid skill name/);
    expect(() => assertSafeSkillName("/abs")).toThrow(/invalid skill name/);
  });

  it("rejects hidden names and empty strings", () => {
    expect(() => assertSafeSkillName(".hidden")).toThrow(/invalid skill name/);
    expect(() => assertSafeSkillName("")).toThrow(/invalid skill name/);
  });
});

describe("assertAbsoluteSkillPath", () => {
  it("accepts absolute paths", () => {
    expect(() => assertAbsoluteSkillPath("/home/agent/.claude/skills/")).not.toThrow();
  });

  it("rejects relative paths", () => {
    expect(() => assertAbsoluteSkillPath("home/agent/skills")).toThrow(/must be absolute/);
    expect(() => assertAbsoluteSkillPath("./skills")).toThrow(/must be absolute/);
  });
});

describe("installSkillInputSchema", () => {
  it("accepts a valid payload", () => {
    const ok = installSkillInputSchema.safeParse({
      source: "https://github.com/anthropics/skills",
      name: "pdf",
      version: "abc123",
      skillPaths: ["/home/agent/.claude/skills/"],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects missing fields and empty skillPaths", () => {
    expect(installSkillInputSchema.safeParse({}).success).toBe(false);
    expect(
      installSkillInputSchema.safeParse({
        source: "x",
        name: "y",
        version: "z",
        skillPaths: [],
      }).success,
    ).toBe(false);
  });
});

describe("uninstallSkillInputSchema", () => {
  it("accepts a valid payload", () => {
    const ok = uninstallSkillInputSchema.safeParse({
      name: "pdf",
      skillPaths: ["/home/agent/.claude/skills/"],
    });
    expect(ok.success).toBe(true);
  });
});

describe("resolveSkillDir", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skill-resolve-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("prefers skills/<name>/SKILL.md when both layouts exist", async () => {
    await fs.mkdir(path.join(tmp, "skills", "pdf"), { recursive: true });
    await fs.writeFile(path.join(tmp, "skills", "pdf", "SKILL.md"), "# nested");
    await fs.mkdir(path.join(tmp, "pdf"), { recursive: true });
    await fs.writeFile(path.join(tmp, "pdf", "SKILL.md"), "# top-level");

    const resolved = await resolveSkillDir(tmp, "pdf");
    expect(resolved).toBe(path.join(tmp, "skills", "pdf"));
  });

  it("falls back to <name>/SKILL.md at repo root", async () => {
    await fs.mkdir(path.join(tmp, "pdf"), { recursive: true });
    await fs.writeFile(path.join(tmp, "pdf", "SKILL.md"), "# top-level");

    const resolved = await resolveSkillDir(tmp, "pdf");
    expect(resolved).toBe(path.join(tmp, "pdf"));
  });

  it("throws when neither location exists", async () => {
    await expect(resolveSkillDir(tmp, "ghost")).rejects.toThrow(
      /not found in source.*skills\/ghost.*ghost/,
    );
  });
});

describe("uninstallSkill", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skill-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("is idempotent on a missing directory", async () => {
    await expect(
      uninstallSkill({ name: "ghost", skillPaths: [path.join(tmp, "skills")] }),
    ).resolves.toBeUndefined();
  });

  it("removes an existing skill directory", async () => {
    const skillsDir = path.join(tmp, "skills");
    const skillDir = path.join(skillsDir, "pdf");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# PDF");

    await uninstallSkill({ name: "pdf", skillPaths: [skillsDir] });

    await expect(fs.access(skillDir)).rejects.toThrow();
  });

  it("rejects unsafe names before touching the filesystem", async () => {
    await expect(
      uninstallSkill({ name: "../etc", skillPaths: [tmp] }),
    ).rejects.toThrow(/invalid skill name/);
  });

  it("rejects relative skillPaths", async () => {
    await expect(
      uninstallSkill({ name: "pdf", skillPaths: ["relative/path"] }),
    ).rejects.toThrow(/must be absolute/);
  });
});

describe("listLocalSkills", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skills-local-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writeSkill(name: string, body: string) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), body);
  }

  it("returns skills parsed from frontmatter, sorted by name", async () => {
    await writeSkill("beta", "---\nname: beta\ndescription: Second skill\n---\nbody");
    await writeSkill("alpha", "---\nname: alpha\ndescription: First skill\n---\nbody");

    const skills = await listLocalSkills([root]);

    expect(skills).toEqual([
      { name: "alpha", description: "First skill", skillPath: root },
      { name: "beta", description: "Second skill", skillPath: root },
    ]);
  });

  it("falls back to the directory name when frontmatter is missing or malformed", async () => {
    await writeSkill("dir-name-only", "# heading, no frontmatter");
    await writeSkill("bad-fm", "---\njust a plain string\n---\nbody");

    const skills = await listLocalSkills([root]);
    const names = skills.map((s) => s.name).sort();
    const descriptions = Object.fromEntries(skills.map((s) => [s.name, s.description]));

    expect(names).toEqual(["bad-fm", "dir-name-only"]);
    expect(descriptions["dir-name-only"]).toBe("");
    expect(descriptions["bad-fm"]).toBe("");
  });

  it("ignores directories without SKILL.md and hidden directories", async () => {
    await fs.mkdir(path.join(root, "no-skill-md"), { recursive: true });
    await fs.writeFile(path.join(root, "no-skill-md", "README.md"), "# nope");
    await fs.mkdir(path.join(root, ".hidden"), { recursive: true });
    await fs.writeFile(path.join(root, ".hidden", "SKILL.md"), "---\nname: hidden\n---");
    await writeSkill("visible", "---\nname: visible\n---");

    const skills = await listLocalSkills([root]);
    expect(skills.map((s) => s.name)).toEqual(["visible"]);
  });

  it("deduplicates by directory name across multiple skillPaths (first wins)", async () => {
    const second = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skills-local-2-"));
    try {
      await writeSkill("shared", "---\nname: shared\ndescription: from first\n---");
      await fs.mkdir(path.join(second, "shared"), { recursive: true });
      await fs.writeFile(path.join(second, "shared", "SKILL.md"), "---\nname: shared\ndescription: from second\n---");

      const skills = await listLocalSkills([root, second]);
      expect(skills).toHaveLength(1);
      expect(skills[0].description).toBe("from first");
      expect(skills[0].skillPath).toBe(root);
    } finally {
      await fs.rm(second, { recursive: true, force: true });
    }
  });

  it("silently skips non-existent skillPaths", async () => {
    await writeSkill("alpha", "---\nname: alpha\n---");
    const skills = await listLocalSkills([root, "/nonexistent/path-xyz"]);
    expect(skills.map((s) => s.name)).toEqual(["alpha"]);
  });

  it("rejects relative skillPaths before touching the filesystem", async () => {
    await expect(listLocalSkills(["relative"])).rejects.toThrow(/must be absolute/);
  });
});
