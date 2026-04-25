import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertAbsoluteSkillPath,
  assertSafeSkillName,
  computeContentHash,
  installSkillInputSchema,
  listLocalSkills,
  parseFrontmatter,
  PayloadTooLargeError,
  readLocalSkill,
  resolveSkillDir,
  scanSource,
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

describe("readLocalSkill", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skills-read-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns every file with text content for text and base64 for binary", async () => {
    const skillDir = path.join(root, "my-draft");
    await fs.mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: my-draft\n---\nhello");
    await fs.writeFile(path.join(skillDir, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");
    // A tiny "binary" file (contains null bytes).
    await fs.writeFile(path.join(skillDir, "logo.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));

    const { files } = await readLocalSkill("my-draft", [root]);
    const byRel = Object.fromEntries(files.map((f) => [f.relPath, f]));

    expect(byRel["SKILL.md"].content).toContain("hello");
    expect(byRel["SKILL.md"].base64).toBeUndefined();

    expect(byRel["scripts/run.sh"].content).toContain("echo hi");
    expect(byRel["scripts/run.sh"].base64).toBeUndefined();

    expect(byRel["logo.bin"].base64).toBe(true);
    expect(Buffer.from(byRel["logo.bin"].content, "base64")).toEqual(Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
  });

  it("throws when the skill is not found", async () => {
    await expect(readLocalSkill("ghost", [root])).rejects.toThrow(/not found/);
  });

  it("rejects unsafe names before touching the filesystem", async () => {
    await expect(readLocalSkill("../etc", [root])).rejects.toThrow(/invalid skill name/);
  });

  it("surfaces PayloadTooLargeError when a single file exceeds the per-file cap", async () => {
    const skillDir = path.join(root, "huge");
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: huge\n---");
    // 3 MB, exceeds the 2 MB per-file cap.
    await fs.writeFile(path.join(skillDir, "blob.bin"), Buffer.alloc(3 * 1024 * 1024));

    await expect(readLocalSkill("huge", [root])).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});

describe("parseFrontmatter", () => {
  it("extracts name and description from a SKILL.md", () => {
    const content = [
      "---",
      "name: pdf",
      "description: Work with PDF files",
      "---",
      "",
      "# PDF skill",
      "",
      "Body content here.",
    ].join("\n");
    expect(parseFrontmatter(content)).toEqual({
      name: "pdf",
      description: "Work with PDF files",
    });
  });

  it("returns an empty object when frontmatter is absent", () => {
    expect(parseFrontmatter("# PDF\n\nNo frontmatter here.")).toEqual({});
  });

  it("tolerates CRLF line endings", () => {
    const content = "---\r\nname: docx\r\ndescription: Word documents\r\n---\r\n\r\nBody";
    expect(parseFrontmatter(content)).toEqual({
      name: "docx",
      description: "Word documents",
    });
  });

  it("ignores malformed non-key lines in the frontmatter block", () => {
    expect(parseFrontmatter("---\njust a string\n---\nbody")).toEqual({});
  });

  it("joins folded (>) block scalars with spaces", () => {
    const content = [
      "---",
      "name: adr",
      "description: >",
      "  Tracks ADRs in docs/adrs/.",
      "  Creates, lists, and updates ADRs.",
      "argument-hint: foo",
      "---",
      "body",
    ].join("\n");
    expect(parseFrontmatter(content)).toEqual({
      name: "adr",
      description: "Tracks ADRs in docs/adrs/. Creates, lists, and updates ADRs.",
    });
  });

  it("joins literal (|) block scalars with newlines", () => {
    const content = [
      "---",
      "name: multi",
      "description: |",
      "  Line one.",
      "  Line two.",
      "---",
      "body",
    ].join("\n");
    expect(parseFrontmatter(content)).toEqual({
      name: "multi",
      description: "Line one.\nLine two.",
    });
  });

  it("stops the block scalar at the first unindented line", () => {
    const content = [
      "---",
      "description: >",
      "  first",
      "  second",
      "name: after",
      "---",
    ].join("\n");
    expect(parseFrontmatter(content)).toEqual({
      name: "after",
      description: "first second",
    });
  });
});

describe("computeContentHash", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "humr-hash-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("is deterministic and depends only on file paths + bytes", async () => {
    await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: a\n---\nbody");
    await fs.mkdir(path.join(dir, "scripts"));
    await fs.writeFile(path.join(dir, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");

    const hash1 = await computeContentHash(dir);
    const hash2 = await computeContentHash(dir);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flips when any file content changes", async () => {
    await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: a\n---\nversion 1");
    const before = await computeContentHash(dir);
    await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: a\n---\nversion 2");
    const after = await computeContentHash(dir);
    expect(after).not.toBe(before);
  });

  it("flips when a file is added", async () => {
    await fs.writeFile(path.join(dir, "SKILL.md"), "---\nname: a\n---");
    const before = await computeContentHash(dir);
    await fs.writeFile(path.join(dir, "NEW.md"), "extra");
    const after = await computeContentHash(dir);
    expect(after).not.toBe(before);
  });

  it("does not change when an unrelated sibling directory changes", async () => {
    await fs.mkdir(path.join(dir, "me"));
    await fs.mkdir(path.join(dir, "sibling"));
    await fs.writeFile(path.join(dir, "me", "SKILL.md"), "mine");
    await fs.writeFile(path.join(dir, "sibling", "SKILL.md"), "v1");
    const meBefore = await computeContentHash(path.join(dir, "me"));
    await fs.writeFile(path.join(dir, "sibling", "SKILL.md"), "v2");
    const meAfter = await computeContentHash(path.join(dir, "me"));
    expect(meAfter).toBe(meBefore);
  });
});

describe("scanSource", () => {
  let repoDir: string;

  function git(...args: string[]): void {
    const result = spawnSync("git", args, {
      cwd: repoDir,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.toString() ?? ""}`);
    }
  }

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "humr-scan-src-"));
    git("init", "--quiet", "-b", "main");
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  async function addSkill(rel: string, frontmatter: string, body = "body\n"): Promise<void> {
    const dir = path.join(repoDir, rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
  }

  it("returns skills from skills/* with frontmatter-derived name/description and a commit SHA", async () => {
    await addSkill("skills/pdf", "name: pdf\ndescription: Work with PDFs");
    await addSkill("skills/docx", "name: docx\ndescription: Word docs");
    git("add", ".");
    git("commit", "--quiet", "-m", "add skills");

    const fileUrl = `file://${repoDir}`;
    const skills = await scanSource(fileUrl);

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(["docx", "pdf"]);
    for (const s of skills) {
      expect(s.source).toBe(fileUrl);
      expect(s.version).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("falls back to top-level */SKILL.md when there's no skills/ dir", async () => {
    await addSkill("adr", "name: adr\ndescription: Architecture decision records");
    git("add", ".");
    git("commit", "--quiet", "-m", "initial");

    const skills = await scanSource(`file://${repoDir}`);

    expect(skills).toEqual([
      expect.objectContaining({ name: "adr", description: "Architecture decision records" }),
    ]);
  });

  it("uses the last-touching commit SHA per skill directory", async () => {
    await addSkill("skills/a", "name: a\ndescription: first");
    git("add", ".");
    git("commit", "--quiet", "-m", "add a");
    const firstSha = spawnSync("git", ["-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

    await addSkill("skills/b", "name: b\ndescription: second");
    git("add", ".");
    git("commit", "--quiet", "-m", "add b");
    const secondSha = spawnSync("git", ["-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();

    const skills = await scanSource(`file://${repoDir}`);
    const byName = Object.fromEntries(skills.map((s) => [s.name, s.version]));

    expect(byName.a).toBe(firstSha);
    expect(byName.b).toBe(secondSha);
  });

  it("falls back to the directory name when frontmatter lacks a `name:`", async () => {
    await addSkill("skills/no-name", "description: missing name field");
    git("add", ".");
    git("commit", "--quiet", "-m", "add no-name");

    const skills = await scanSource(`file://${repoDir}`);
    expect(skills[0].name).toBe("no-name");
  });
});

describe("scanSource — GitHub tarball path", () => {
  const fetchMock = vi.fn();
  let fixtureRoot: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "humr-scan-fixture-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  function okJson(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  async function makeTarball(
    rootName: string,
    files: Record<string, string>,
  ): Promise<Buffer> {
    const root = path.join(fixtureRoot, rootName);
    await fs.mkdir(root, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }
    const tgzPath = path.join(fixtureRoot, `${rootName}.tgz`);
    const res = spawnSync("tar", ["-czf", tgzPath, "-C", fixtureRoot, rootName]);
    if (res.status !== 0) throw new Error(`tar failed: ${res.stderr?.toString() ?? ""}`);
    return fs.readFile(tgzPath);
  }

  it("fetches HEAD SHA + tarball, walks local files, returns sorted skills with uniform version", async () => {
    const sha = "e94e714a8c27b0196448e018935dabbb38c3bdf8";
    const tarball = await makeTarball("acme-tools-e94e714", {
      "skills/pdf/SKILL.md": "---\nname: pdf\ndescription: Work with PDFs\n---\nbody",
      "skills/docx/SKILL.md": "---\nname: docx\ndescription: Word docs\n---\nbody",
      "README.md": "# skills",
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/repos/acme/tools/commits/HEAD")) return okJson({ sha });
      if (url.includes(`/tarball/${sha}`)) return new Response(new Uint8Array(tarball), { status: 200 });
      throw new Error(`unmocked: ${url}`);
    });

    const skills = await scanSource("https://github.com/acme/tools");

    expect(skills.map((s) => ({ name: s.name, description: s.description, version: s.version }))).toEqual([
      { name: "docx", description: "Word docs", version: sha },
      { name: "pdf", description: "Work with PDFs", version: sha },
    ]);
    // Every skill carries a deterministic content hash, not equal across skills.
    expect(skills[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(skills[1].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(skills[0].contentHash).not.toEqual(skills[1].contentHash);
    // Exactly two API calls regardless of skill count.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers skills/*/SKILL.md over <name>/SKILL.md at repo root when both exist", async () => {
    const sha = "c0ffee0";
    const tarball = await makeTarball("acme-tools-c0ffee0", {
      "adr/SKILL.md": "---\nname: adr\ndescription: ROOT\n---",
      "skills/adr/SKILL.md": "---\nname: adr\ndescription: NESTED\n---",
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/commits/HEAD")) return okJson({ sha });
      if (url.includes("/tarball/")) return new Response(new Uint8Array(tarball), { status: 200 });
      throw new Error(`unmocked: ${url}`);
    });

    const skills = await scanSource("https://github.com/acme/tools");

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      source: "https://github.com/acme/tools",
      name: "adr",
      description: "NESTED",
      version: sha,
    });
    expect(skills[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back to the directory name when frontmatter lacks a `name:`", async () => {
    const sha = "beef";
    const tarball = await makeTarball("acme-tools-beef", {
      "skills/no-name/SKILL.md": "---\ndescription: missing name\n---",
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/commits/HEAD")) return okJson({ sha });
      if (url.includes("/tarball/")) return new Response(new Uint8Array(tarball), { status: 200 });
      throw new Error(`unmocked: ${url}`);
    });

    const skills = await scanSource("https://github.com/acme/tools");
    expect(skills[0].name).toBe("no-name");
  });

  it("retries with auth on 404 so private-repo-without-Connect-GitHub surfaces the CTA", async () => {
    // Anonymous preflight returns 404 (private repo invisible to anon); the
    // auth retry hits OneCLI's gateway, which returns app_not_connected with
    // the connect_url the UI renders as "Connect GitHub →".
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "app_not_connected",
            message: "GitHub not connected",
            connect_url: "http://localhost:4444/connections?connect=github",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );

    await expect(scanSource("https://github.com/acme/tools")).rejects.toMatchObject({
      cause: expect.objectContaining({
        status: 401,
        body: expect.objectContaining({
          error: "app_not_connected",
          connect_url: expect.stringContaining("localhost:4444"),
        }),
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit | undefined;
    // First call is anonymous (no Authorization), retry sends the Bearer
    // sentinel so OneCLI can surface the structured error.
    expect((firstInit?.headers as Record<string, string>)?.Authorization).toBeUndefined();
    expect((secondInit?.headers as Record<string, string>)?.Authorization).toMatch(/^Bearer /);
  });

  it("propagates non-404 errors without retrying", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Server exploded" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(scanSource("https://github.com/acme/tools")).rejects.toMatchObject({
      cause: expect.objectContaining({ status: 500 }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
