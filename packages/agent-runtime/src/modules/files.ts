import { dirname, join, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat as statAsync, writeFile } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import type { FilesService } from "agent-runtime-api";

const EXCLUDE = new Set([".git", ".npm", ".triggers", ".claude.json", ".initialized", "node_modules", ".DS_Store"]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Fallback check for binary content when magic-byte detection fails. Null bytes in the first 8 KB are a reliable signal. */
function hasNullBytes(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

function buildTree(
  dir: string,
  base = "",
): { path: string; type: "file" | "dir" }[] {
  const entries: { path: string; type: "file" | "dir" }[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(ent.name)) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      entries.push({ path: rel, type: "dir" });
      entries.push(...buildTree(join(dir, ent.name), rel));
    } else {
      entries.push({ path: rel, type: "file" });
    }
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function safePath(workingDir: string, rel: string): string | null {
  const resolved = resolve(workingDir, rel);
  if (!resolved.startsWith(resolve(workingDir))) return null;
  return resolved;
}

/** Every segment of a writable path must be outside the EXCLUDE set — this
 *  blocks writes into .git/*, node_modules/*, and the like even though those
 *  are invisible to the tree. Empty / traversal segments are rejected so the
 *  caller can return a safe error without relying on safePath alone. */
function isWritablePath(rel: string): boolean {
  if (!rel) return false;
  const parts = rel.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") return false;
    if (EXCLUDE.has(part)) return false;
  }
  return true;
}

export function createFilesService(workingDir: string): FilesService {
  const toAbs = (rel: string): string | null => safePath(workingDir, rel);
  const toWritableAbs = (rel: string): string | null => {
    if (!isWritablePath(rel)) return null;
    return toAbs(rel);
  };

  return {
    buildTree: () => buildTree(workingDir),
    readFileSafe: async (rel) => {
      if (!rel) return null;
      const abs = toAbs(rel);
      if (!abs) return null;
      try {
        const s = await statAsync(abs);
        if (!s.isFile()) return null;
        if (s.size > MAX_FILE_SIZE) {
          return { path: rel, binary: true };
        }
        const type = await fileTypeFromFile(abs);
        const buf = await readFile(abs);
        const mtimeMs = s.mtimeMs;
        if (type) {
          return { path: rel, content: buf.toString("base64"), binary: true, mimeType: type.mime, mtimeMs };
        }
        // file-type only detects known binary formats. Fall back to null-byte check
        // to catch unknown binary formats (raw .bin dumps, proprietary formats, etc.)
        if (hasNullBytes(buf)) {
          return { path: rel, content: buf.toString("base64"), binary: true, mimeType: "application/octet-stream", mtimeMs };
        }
        // Text-based format
        const content = buf.toString("utf8");
        const lower = rel.toLowerCase();
        const mimeType =
          lower.endsWith(".svg") ? "image/svg+xml" :
          lower.endsWith(".json") || lower.endsWith(".jsonl") ? "application/json" :
          lower.endsWith(".csv") ? "text/csv" :
          lower.endsWith(".html") || lower.endsWith(".htm") ? "text/html" :
          lower.endsWith(".md") || lower.endsWith(".mdx") ? "text/markdown" :
          lower.endsWith(".xml") ? "application/xml" :
          "text/plain";
        return { path: rel, content, mimeType, mtimeMs };
      } catch {
        return null;
      }
    },
    writeFileSafe: async (rel, content, expectedMtimeMs) => {
      const abs = toWritableAbs(rel);
      if (!abs) throw new Error("forbidden path");
      if (expectedMtimeMs !== undefined) {
        // Optimistic concurrency: refuse to clobber if the file changed under us.
        // A missing file is treated as a conflict rather than a silent create so
        // the UI can decide whether to recover. createFileSafe is the right call
        // for net-new writes.
        try {
          const s = await statAsync(abs);
          if (Math.abs(s.mtimeMs - expectedMtimeMs) > 0.5) {
            return { conflict: true, currentMtimeMs: s.mtimeMs };
          }
        } catch {
          return { conflict: true, currentMtimeMs: 0 };
        }
      }
      await writeFile(abs, content, "utf8");
      const s = await statAsync(abs);
      return { mtimeMs: s.mtimeMs };
    },
    createFileSafe: async (rel, content) => {
      const abs = toWritableAbs(rel);
      if (!abs) throw new Error("forbidden path");
      await mkdir(dirname(abs), { recursive: true });
      try {
        // `wx` fails when the path exists — we want "create" to be strict so
        // the UI can prompt for an alternative name instead of clobbering.
        await writeFile(abs, content, { flag: "wx", encoding: "utf8" });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "EEXIST") return { exists: true };
        throw err;
      }
      const s = await statAsync(abs);
      return { mtimeMs: s.mtimeMs };
    },
    mkdirSafe: async (rel) => {
      const abs = toWritableAbs(rel);
      if (!abs) throw new Error("forbidden path");
      try {
        const s = await statAsync(abs);
        if (!s.isDirectory()) return { exists: true };
        return { ok: true };
      } catch {
        // Does not exist — create it.
      }
      await mkdir(abs, { recursive: true });
      return { ok: true };
    },
    renameSafe: async (from, to, overwrite) => {
      const fromAbs = toWritableAbs(from);
      const toAbs2 = toWritableAbs(to);
      if (!fromAbs || !toAbs2) throw new Error("forbidden path");
      if (!overwrite) {
        try {
          await statAsync(toAbs2);
          return { exists: true };
        } catch {
          // destination is free
        }
      }
      await mkdir(dirname(toAbs2), { recursive: true });
      await rename(fromAbs, toAbs2);
      return { ok: true };
    },
    deleteSafe: async (rel) => {
      const abs = toWritableAbs(rel);
      if (!abs) throw new Error("forbidden path");
      await rm(abs, { recursive: true, force: false });
      return { ok: true };
    },
    uploadFileSafe: async (rel, base64, overwrite) => {
      const abs = toWritableAbs(rel);
      if (!abs) throw new Error("forbidden path");
      const buf = Buffer.from(base64, "base64");
      if (buf.length > MAX_FILE_SIZE) throw new Error("file too large");
      if (!overwrite) {
        try {
          await statAsync(abs);
          return { exists: true };
        } catch {
          // destination is free
        }
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      const s = await statAsync(abs);
      return { mtimeMs: s.mtimeMs, absolutePath: abs };
    },
  };
}
