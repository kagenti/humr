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

export interface LocalSkill {
  name: string;
  description: string;
  skillPath: string;
}

/**
 * Minimal frontmatter parser — mirrors the one in the api-server's
 * skill-scanner. Duplicated intentionally so agent-runtime doesn't grow a
 * shared package dependency.
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^(name|description):\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim().replace(/^["']|["']$/g, "");
    if (raw) out[m[1] as "name" | "description"] = raw;
  }
  return out;
}

const FRONTMATTER_READ_BYTES = 8 * 1024;

export interface LocalSkillFile {
  relPath: string;           // relative to the skill dir
  content: string;           // UTF-8 text, or base64-encoded bytes when binary
  base64?: true;
}

/** Max total raw bytes read per readLocalSkill call. Bigger → 413. */
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
/** Skip any individual file above this size — a large binary isn't what
 *  we're here for. Keeps surprises bounded inside the total cap. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function hasNullBytes(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

async function findLocalSkillDir(name: string, skillPaths: string[]): Promise<string | null> {
  assertSafeSkillName(name);
  for (const base of skillPaths) {
    assertAbsoluteSkillPath(base);
    const candidate = path.join(base, name);
    try {
      await fs.access(path.join(candidate, "SKILL.md"));
      return candidate;
    } catch {}
  }
  return null;
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await rec(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  await rec(root);
  return out;
}

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export interface PublishSkillOpts {
  name: string;
  skillPaths: string[];
  owner: string;
  repo: string;
  title: string;
  body: string;
}

export interface PublishSkillResult {
  prUrl: string;
  branch: string;
}

const GITHUB_API = "https://api.github.com";

interface GithubError {
  status?: number;
  error?: string;      // OneCLI gateway error codes (app_not_connected, access_restricted, …)
  message?: string;
  connect_url?: string;
  manage_url?: string;
  provider?: string;
}

/** Call an `api.github.com` endpoint. Passes the sentinel bearer; OneCLI's MITM
 *  swaps it for the user's OAuth token. Throws a structured Error whose
 *  `cause` carries OneCLI's JSON payload so the caller can extract
 *  connect_url/manage_url. */
async function githubFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.GH_TOKEN ?? "humr:sentinel";
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function githubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await githubFetch(path, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err: GithubError =
      typeof body === "object" && body !== null ? (body as GithubError) : {};
    const detail =
      err.message ?? (typeof body === "string" && body ? body : "github error");
    const e = new Error(`github ${init?.method ?? "GET"} ${path} → ${res.status}: ${detail}`);
    (e as Error & { cause?: unknown }).cause = { status: res.status, body: err };
    throw e;
  }
  return body as T;
}

/**
 * Publish a local skill to GitHub as a new branch + PR. Executes entirely
 * via the REST API through OneCLI's MITM — no git subprocess, no working
 * copy on disk. Requires:
 *   - this pod to be running with `GH_TOKEN=humr:sentinel` + `HTTPS_PROXY`
 *     pre-wired by the controller (always true in Humr)
 *   - OneCLI to have `GITHUB_CLIENT_ID/SECRET` configured
 *   - the current user to have Connect GitHub done in OneCLI
 *   - this agent to be granted access to that GitHub connection
 * Failure on any of the last three surfaces as a 401/403 from OneCLI's gateway
 * with a structured error body (connect_url / manage_url) the caller can
 * relay to the UI.
 */
export async function publishSkill(opts: PublishSkillOpts): Promise<PublishSkillResult> {
  const { files } = await readLocalSkill(opts.name, opts.skillPaths);
  const base = `/repos/${opts.owner}/${opts.repo}`;

  const repoInfo = await githubJson<{ default_branch: string }>(base);
  const defaultBranch = repoInfo.default_branch;

  const headRef = await githubJson<{ object: { sha: string } }>(
    `${base}/git/refs/heads/${encodeURIComponent(defaultBranch)}`,
  );
  const headSha = headRef.object.sha;

  // 1. Create a blob per file.
  const blobs = await Promise.all(
    files.map(async (f) => {
      const blob = await githubJson<{ sha: string }>(`${base}/git/blobs`, {
        method: "POST",
        body: JSON.stringify(
          f.base64
            ? { content: f.content, encoding: "base64" }
            : { content: f.content, encoding: "utf-8" },
        ),
      });
      return { path: `skills/${opts.name}/${f.relPath}`, sha: blob.sha };
    }),
  );

  // 2. Tree referencing the blobs, parented on the default-branch HEAD tree.
  const tree = await githubJson<{ sha: string }>(`${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: headSha,
      tree: blobs.map((b) => ({
        path: b.path,
        mode: "100644",
        type: "blob",
        sha: b.sha,
      })),
    }),
  });

  // 3. Commit pointing at the tree.
  const commit = await githubJson<{ sha: string }>(`${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Add ${opts.name} skill\n\nPublished from Humr.`,
      tree: tree.sha,
      parents: [headSha],
      author: {
        name: "Humr",
        email: "humr-publish@users.noreply.github.com",
      },
    }),
  });

  // 4. Create the branch ref.
  const branch = `humr/publish-${opts.name}-${branchTimestamp()}`;
  await githubJson(`${base}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  });

  // 5. Open the PR.
  const pr = await githubJson<{ html_url: string }>(`${base}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      head: branch,
      base: defaultBranch,
    }),
  });

  return { prUrl: pr.html_url, branch };
}

function branchTimestamp(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/**
 * Read a local skill's directory and return every file (SKILL.md + scripts/
 * + whatever else) as a JSON-friendly payload. Text files come back as UTF-8
 * strings; binary files are base64-encoded with `base64: true`. The api-server
 * uses this to populate a cloned repo before committing.
 */
export async function readLocalSkill(name: string, skillPaths: string[]): Promise<{ files: LocalSkillFile[] }> {
  const root = await findLocalSkillDir(name, skillPaths);
  if (!root) throw new Error(`skill ${JSON.stringify(name)} not found in any skillPath`);

  const absFiles = (await walkFiles(root)).sort();
  const out: LocalSkillFile[] = [];
  let total = 0;

  for (const abs of absFiles) {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) {
      throw new PayloadTooLargeError(`${path.relative(root, abs)} is ${stat.size} bytes (max ${MAX_FILE_BYTES})`);
    }
    total += stat.size;
    if (total > MAX_SKILL_BYTES) {
      throw new PayloadTooLargeError(`skill exceeds ${MAX_SKILL_BYTES} bytes total`);
    }
    const buf = await fs.readFile(abs);
    const relPath = path.relative(root, abs);
    if (hasNullBytes(buf)) {
      out.push({ relPath, content: buf.toString("base64"), base64: true });
    } else {
      out.push({ relPath, content: buf.toString("utf8") });
    }
  }

  return { files: out };
}

/**
 * Enumerate skill directories under each path. A directory is a skill when it
 * contains SKILL.md. Dedup by directory name across paths (first-wins), and
 * ignore dot-prefixed entries.
 */
export async function listLocalSkills(skillPaths: string[]): Promise<LocalSkill[]> {
  for (const p of skillPaths) assertAbsoluteSkillPath(p);

  const seen = new Set<string>();
  const out: LocalSkill[] = [];

  for (const skillPath of skillPaths) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(skillPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith(".")) continue;
      if (seen.has(ent.name)) continue;

      const skillMd = path.join(skillPath, ent.name, "SKILL.md");
      let fd: import("node:fs/promises").FileHandle;
      try {
        fd = await fs.open(skillMd, "r");
      } catch {
        continue;
      }
      try {
        const buf = Buffer.alloc(FRONTMATTER_READ_BYTES);
        const { bytesRead } = await fd.read(buf, 0, FRONTMATTER_READ_BYTES, 0);
        const fm = parseFrontmatter(buf.subarray(0, bytesRead).toString("utf8"));
        seen.add(ent.name);
        out.push({
          name: fm.name?.trim() || ent.name,
          description: fm.description?.trim() || "",
          skillPath,
        });
      } finally {
        await fd.close();
      }
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

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
