import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

export const scanSkillSourceInputSchema = z.object({
  source: z.string().min(1),
});
export type ScanSkillSourceInput = z.infer<typeof scanSkillSourceInputSchema>;

export interface ScannedSkill {
  source: string;
  name: string;
  description: string;
  version: string;
  contentHash: string;
}

/**
 * Deterministic SHA-256 of a skill directory's contents — hashes every file
 * under the dir in sorted-path order, mixing the relative path and body bytes.
 * Used as the drift signal: changes iff the skill's files change, completely
 * independent of git commit history. Matches api-server's computeContentHash.
 */
export async function computeContentHash(absDir: string): Promise<string> {
  const files = (await walkFiles(absDir)).sort();
  const h = createHash("sha256");
  for (const abs of files) {
    const rel = path.relative(absDir, abs);
    h.update(rel);
    h.update(Buffer.from([0]));
    h.update(await fs.readFile(abs));
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

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
/**
 * Extract `name` and `description` from a SKILL.md's YAML frontmatter.
 * Handles plain scalars (`description: foo`), folded block scalars
 * (`description: >`), and literal block scalars (`description: |`) —
 * apocohq's catalog uses `>` with line continuations, which a naive parser
 * surfaces as the literal character `>`.
 */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const out: { name?: string; description?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1] as "name" | "description";
    const raw = m[2].trim();

    // Block scalars — `>` (folded, lines joined with a space) or `|` (literal,
    // lines joined with newlines). The header line itself has no content; the
    // value lives in the following indented lines.
    const blockMatch = /^([>|])[+-]?$/.exec(raw);
    if (blockMatch) {
      const folded = blockMatch[1] === ">";
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const line = lines[j];
        if (line.trim() === "") {
          collected.push("");
          j++;
          continue;
        }
        if (!/^\s+/.test(line)) break;
        collected.push(line.replace(/^\s+/, ""));
        j++;
      }
      while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
      out[key] = folded ? collected.join(" ") : collected.join("\n");
      i = j - 1;
      continue;
    }

    const unquoted = raw.replace(/^["']|["']$/g, "");
    if (unquoted) out[key] = unquoted;
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

/**
 * Call an `api.github.com` endpoint.
 *
 * When `withAuth` is true, attach the sentinel bearer — OneCLI's MITM swaps
 * it for the user's OAuth token. Needed for mutating endpoints (publish)
 * and for endpoints that fail "quietly" with 404 when unauthenticated
 * (so we'd rather get the structured `app_not_connected` CTA instead).
 *
 * When `withAuth` is false, send no Authorization header. OneCLI passes
 * through anonymous reads for public resources and *still* injects the
 * user's token automatically if they're Connected (confirmed empirically
 * against private repos). This is the hard-requirement path for scan:
 * public repos must work even when the user hasn't Connected GitHub yet.
 *
 * Thrown Error's `cause` carries OneCLI's JSON payload so callers can
 * extract connect_url/manage_url.
 */
async function githubFetch(
  path: string,
  init?: RequestInit,
  opts: { withAuth?: boolean } = {},
): Promise<Response> {
  const withAuth = opts.withAuth ?? true;
  const token = process.env.GH_TOKEN ?? "humr:sentinel";
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      ...(withAuth ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

async function githubJson<T>(
  path: string,
  init?: RequestInit,
  opts: { withAuth?: boolean } = {},
): Promise<T> {
  const res = await githubFetch(path, init, opts);
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

interface DetectedOwnerRepo { owner: string; repo: string; }

/** Mirrors api-server's detectHost but inline — agent-runtime avoids a
 *  cross-package dependency. Only GitHub is recognized; other hosts skip
 *  the pre-flight and fall through to an anonymous clone. */
function detectGithubOwnerRepo(gitUrl: string): DetectedOwnerRepo | null {
  const trimmed = gitUrl.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(trimmed);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Walk a freshly-cloned repo and return every directory (relative to the
 * clone root) that contains a SKILL.md. Prefers `skills/*` first, falls back
 * to top-level `*` — same search order resolveSkillDir uses for install.
 */
async function findSkillDirsInClone(repoDir: string): Promise<string[]> {
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

async function runCapture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

/**
 * Enumerate skills in a remote git source.
 *
 * For GitHub URLs we walk the repo via `api.github.com` (tree → blob → commits).
 * Reasons:
 *   - OneCLI's Bearer-sentinel swap on `api.github.com` is stable; the
 *     Basic-auth swap on `github.com/*.git` git-protocol traffic has been
 *     observed to flip to returning 401 "invalid credentials" after a burst
 *     of concurrent requests (symptom: every subsequent `git clone` through
 *     the proxy gets rejected until OneCLI is restarted).
 *   - Same proven path publish already uses — one codepath, one auth
 *     surface, one set of structured-error cases to handle.
 *   - OneCLI's 401 responses on `/repos/:owner/:repo` carry `connect_url` /
 *     `manage_url` — surfaces the three user-correctable preconditions
 *     (not connected, agent not granted, repo not in OAuth App's allowed
 *     list) with no extra plumbing.
 *
 * For non-GitHub URLs we fall back to an anonymous `git clone`. Non-GitHub
 * authenticated discovery is out of scope (ADR-marked).
 */
export async function scanSource(gitUrl: string): Promise<ScannedSkill[]> {
  const host = detectGithubOwnerRepo(gitUrl);
  if (host) return scanGithubSource(gitUrl, host);
  return scanViaGitClone(gitUrl);
}

interface CommitObject { sha: string; }

async function scanGithubSource(
  gitUrl: string,
  host: DetectedOwnerRepo,
): Promise<ScannedSkill[]> {
  // Two calls, flat-scaling: resolve HEAD SHA, then pull the whole tree as a
  // tarball and walk locally. The previous tree+blobs+commits-per-skill path
  // hit 1 + 2N api.github.com requests — fine at 3 skills, unpleasant at 30.
  //
  // Trade-off vs per-skill last-touching SHA: `version` is now the source's
  // HEAD commit at scan time, uniform across the catalogue. Drift-detection
  // lights up the Update badge on *every* installed skill whenever the source
  // gets any commit, not just when the skill dir itself was touched. The
  // Update click still does the right thing (re-installs at current HEAD);
  // it's just noisier. Accepted trade: scan stays fast and predictable.
  const base = `/repos/${host.owner}/${host.repo}`;

  // Anonymous preflight. OneCLI passes public repos through and auto-injects
  // the user's token for private repos when they're Connected — so the happy
  // path is one call. A 404 here is ambiguous: could be truly-not-found, OR
  // could be a private repo the caller can't see because they're not
  // Connected. We retry with the sentinel to let OneCLI's gateway return
  // the structured `app_not_connected` / `access_restricted` error with the
  // CTA URL, which the UI renders as "Connect GitHub →".
  let headCommit: CommitObject;
  try {
    headCommit = await githubJson<CommitObject>(`${base}/commits/HEAD`, undefined, { withAuth: false });
  } catch (err) {
    const cause = (err as Error & { cause?: { status?: number } }).cause;
    if (cause?.status === 404) {
      headCommit = await githubJson<CommitObject>(`${base}/commits/HEAD`, undefined, { withAuth: true });
    } else {
      throw err;
    }
  }
  const version = headCommit.sha;

  // Tarball is served by api.github.com (with a redirect to codeload.github.com
  // that OneCLI follows transparently — verified empirically). For a typical
  // skill repo this is ~50-500 KB, fetched in ~1 s.
  const tarballRes = await githubFetch(`${base}/tarball/${version}`, undefined, { withAuth: false });
  if (!tarballRes.ok) {
    const text = await tarballRes.text().catch(() => "");
    throw new Error(`github GET ${base}/tarball/${version} → ${tarballRes.status}: ${text.slice(0, 200)}`);
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skills-scan-"));
  try {
    const tgz = path.join(tmp, "src.tgz");
    await fs.writeFile(tgz, Buffer.from(await tarballRes.arrayBuffer()));
    await run("tar", ["-xzf", tgz, "-C", tmp]);
    await fs.rm(tgz);

    // GitHub tarballs wrap contents in a single top-level dir like
    // `{owner}-{repo}-{short-sha}`. Find it and scan from there.
    const extracted = (await fs.readdir(tmp, { withFileTypes: true })).filter((e) => e.isDirectory());
    if (extracted.length === 0) throw new Error("tarball contained no directories");
    const repoDir = path.join(tmp, extracted[0].name);

    const skillDirs = await findSkillDirsInClone(repoDir);
    const out = await Promise.all(
      skillDirs.map(async (rel) => {
        const absDir = path.join(repoDir, rel);
        const content = await fs.readFile(path.join(absDir, "SKILL.md"), "utf8");
        const fm = parseFrontmatter(content);
        const contentHash = await computeContentHash(absDir);
        return {
          source: gitUrl,
          name: fm.name?.trim() || path.basename(rel),
          description: fm.description?.trim() || "",
          version,
          contentHash,
        };
      }),
    );
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function scanViaGitClone(gitUrl: string): Promise<ScannedSkill[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "humr-skills-scan-"));
  try {
    await run("git", ["clone", "--quiet", "--depth", "50", gitUrl, tmp]);
    const skillDirs = await findSkillDirsInClone(tmp);
    const out: ScannedSkill[] = [];
    for (const rel of skillDirs) {
      const absDir = path.join(tmp, rel);
      const content = await fs.readFile(path.join(absDir, "SKILL.md"), "utf8");
      const fm = parseFrontmatter(content);
      const name = fm.name?.trim() || path.basename(rel);
      const description = fm.description?.trim() || "";
      const version = (await runCapture("git", ["-C", tmp, "log", "-1", "--format=%H", "--", rel])).trim();
      const contentHash = await computeContentHash(absDir);
      out.push({ source: gitUrl, name, description, version, contentHash });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
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
 * Fetch the source at a specific commit SHA into dest.
 *
 * For GitHub URLs we use `api.github.com/repos/:o/:r/tarball/:sha`: anonymous
 * first (works for public repos and for Connected users via OneCLI's auto-
 * injection), retried with the Bearer sentinel on 404 so private-without-
 * Connect-GitHub surfaces the structured `app_not_connected` / `access_
 * restricted` CTA. This sidesteps OneCLI's Basic-auth swap flip bug on
 * github.com git-protocol traffic that makes `git clone` through the proxy
 * unreliable under concurrent load.
 *
 * Non-GitHub URLs fall back to a plain `git clone` (uncommon today;
 * authenticated discovery for those hosts isn't implemented).
 */
async function cloneAtVersion(source: string, version: string, dest: string): Promise<void> {
  const host = detectGithubOwnerRepo(source);
  if (host) {
    await extractGithubTarball(host, version, dest);
    return;
  }
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
 * Download a GitHub tarball at the given commit SHA and untar it into dest
 * (which must be empty). `--strip-components=1` removes the tarball's
 * auto-generated `{owner}-{repo}-{shortsha}/` wrapper so dest ends up with
 * the repo contents at its root — matching the shape the rest of installSkill
 * expects.
 */
async function extractGithubTarball(
  host: DetectedOwnerRepo,
  version: string,
  dest: string,
): Promise<void> {
  const urlPath = `/repos/${host.owner}/${host.repo}/tarball/${encodeURIComponent(version)}`;
  let res = await githubFetch(urlPath, undefined, { withAuth: false });
  if (res.status === 404) {
    // Could be private and the caller isn't Connected / agent not granted —
    // retry with the sentinel so OneCLI can return a structured CTA body
    // instead of an opaque 404.
    res = await githubFetch(urlPath, undefined, { withAuth: true });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : text; } catch { body = text; }
    const detail = typeof body === "object" && body !== null && "message" in body
      ? (body as { message?: string }).message ?? ""
      : (typeof body === "string" ? body.slice(0, 200) : "");
    const e = new Error(`github tarball ${urlPath} → ${res.status}: ${detail}`);
    (e as Error & { cause?: unknown }).cause = { status: res.status, body };
    throw e;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tgz = path.join(dest, "_src.tgz");
  await fs.writeFile(tgz, buf);
  await run("tar", ["-xzf", tgz, "--strip-components=1", "-C", dest]);
  await fs.rm(tgz);
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

export interface InstallSkillResult {
  /** Deterministic SHA-256 of the installed skill dir. Returned so the
   *  api-server can persist it to `spec.skills` even when the install
   *  request didn't ship one — important for agent-initiated installs via
   *  the MCP tool, which skip the scan step entirely. */
  contentHash: string;
}

export async function installSkill(input: InstallSkillInput): Promise<InstallSkillResult> {
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
    // All install targets receive the same contents, so hashing the first
    // is sufficient. Computed from the installed dir (rather than from the
    // source tmpdir) so the hash reflects what actually landed on the pod.
    const firstTarget = path.join(input.skillPaths[0], input.name);
    const contentHash = await computeContentHash(firstTarget);
    return { contentHash };
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
