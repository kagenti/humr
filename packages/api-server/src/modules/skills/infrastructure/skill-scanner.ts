import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import type { Skill } from "api-server-api";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 60_000;

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Parse the YAML frontmatter block at the top of a SKILL.md file (delimited
 * by --- lines). Returns an empty object if no frontmatter is present.
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const parsed = yaml.load(match[1]) as SkillFrontmatter | null;
  return parsed && typeof parsed === "object" ? parsed : {};
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/**
 * List directories that contain a SKILL.md, searching under `skills/` first
 * (de facto standard) then falling back to top-level. Entries are returned
 * relative to `repoDir`.
 */
async function findSkillDirs(repoDir: string): Promise<string[]> {
  const found: string[] = [];
  const candidates = [path.join(repoDir, "skills"), repoDir];
  for (const root of candidates) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      const dir = path.join(root, ent.name);
      try {
        await fs.access(path.join(dir, "SKILL.md"));
        found.push(path.relative(repoDir, dir));
      } catch {}
    }
    if (found.length > 0) return found;
  }
  return found;
}

/**
 * Clone a git source at HEAD, enumerate skill directories, parse each
 * SKILL.md's frontmatter, and return the skill metadata plus the last
 * commit SHA that touched the directory.
 */
export async function scanSource(gitUrl: string): Promise<Skill[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skills-scan-"));
  try {
    await git(["clone", "--quiet", "--depth", "50", gitUrl, tmp]);
    const skillDirs = await findSkillDirs(tmp);
    const skills: Skill[] = [];
    for (const rel of skillDirs) {
      const content = await fs.readFile(path.join(tmp, rel, "SKILL.md"), "utf8");
      const fm = parseFrontmatter(content);
      const name = typeof fm.name === "string" && fm.name.trim()
        ? fm.name.trim()
        : path.basename(rel);
      const description = typeof fm.description === "string" ? fm.description.trim() : "";
      const version = (await git(["log", "-1", "--format=%H", "--", rel], tmp)).trim();
      skills.push({ source: gitUrl, name, description, version });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
