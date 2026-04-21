import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod/v4";

export const installSkillInputSchema = z.object({
  source: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});

export const uninstallSkillInputSchema = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
});

export type InstallSkillInput = z.infer<typeof installSkillInputSchema>;
export type UninstallSkillInput = z.infer<typeof uninstallSkillInputSchema>;

const COMMAND_TIMEOUT_MS = 60_000;

export function assertSafeSkillName(name: string): void {
  if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) {
    throw new Error(`invalid skill name ${JSON.stringify(name)}`);
  }
}

export function assertAbsoluteSkillPath(p: string): void {
  if (!p.startsWith("/")) {
    throw new Error(`skillPath must be absolute: ${JSON.stringify(p)}`);
  }
}

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

/**
 * Fetch the source at a specific commit SHA into dest. Prefers a shallow
 * init+fetch (works on GitHub and other hosts that allow SHA fetches); falls
 * back to a full clone + checkout if the host rejects SHA fetches.
 */
async function cloneAtVersion(source: string, version: string, dest: string): Promise<void> {
  try {
    await run("git", ["init", "--quiet", dest]);
    await run("git", ["-C", dest, "remote", "add", "origin", source]);
    await run("git", ["-C", dest, "fetch", "--depth", "1", "origin", version]);
    await run("git", ["-C", dest, "checkout", "--quiet", "FETCH_HEAD"]);
    return;
  } catch {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.mkdir(dest, { recursive: true });
  }
  await run("git", ["clone", "--quiet", source, dest]);
  await run("git", ["-C", dest, "checkout", "--quiet", version]);
}

/**
 * Locate the skill directory inside a cloned source. Tries the de-facto
 * standard `skills/<name>/` first, then a bare `<name>/` at repo root.
 */
export async function resolveSkillDir(tmp: string, name: string): Promise<string> {
  for (const candidate of [path.join(tmp, "skills", name), path.join(tmp, name)]) {
    try {
      await fs.access(path.join(candidate, "SKILL.md"));
      return candidate;
    } catch {}
  }
  throw new Error(
    `skill ${JSON.stringify(name)} not found in source (looked in skills/${name}/ and ${name}/)`,
  );
}

export async function installSkill(input: InstallSkillInput): Promise<void> {
  assertSafeSkillName(input.name);
  for (const p of input.skillPaths) assertAbsoluteSkillPath(p);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skill-"));
  try {
    await cloneAtVersion(input.source, input.version, tmp);
    const srcDir = await resolveSkillDir(tmp, input.name);
    for (const targetRoot of input.skillPaths) {
      await fs.mkdir(targetRoot, { recursive: true });
      const dst = path.join(targetRoot, input.name);
      await fs.rm(dst, { recursive: true, force: true });
      await fs.cp(srcDir, dst, { recursive: true });
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function uninstallSkill(input: UninstallSkillInput): Promise<void> {
  assertSafeSkillName(input.name);
  for (const p of input.skillPaths) assertAbsoluteSkillPath(p);

  for (const targetRoot of input.skillPaths) {
    const dst = path.join(targetRoot, input.name);
    await fs.rm(dst, { recursive: true, force: true });
  }
}
