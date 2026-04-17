import { join } from "node:path";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { readFile, stat as statAsync } from "node:fs/promises";
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

export function createFilesService(workingDir: string): FilesService {
  return {
    buildTree: () => buildTree(workingDir),
    readFileSafe: async (rel) => {
      if (!rel) return null;
      const abs = safePath(workingDir, rel);
      if (!abs) return null;
      try {
        const s = await statAsync(abs);
        if (!s.isFile()) return null;
        if (s.size > MAX_FILE_SIZE) {
          return { path: rel, binary: true };
        }
        const type = await fileTypeFromFile(abs);
        const buf = await readFile(abs);
        if (type) {
          return { path: rel, content: buf.toString("base64"), binary: true, mimeType: type.mime };
        }
        // file-type only detects known binary formats. Fall back to null-byte check
        // to catch unknown binary formats (raw .bin dumps, proprietary formats, etc.)
        if (hasNullBytes(buf)) {
          return { path: rel, content: buf.toString("base64"), binary: true, mimeType: "application/octet-stream" };
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
        return { path: rel, content, mimeType };
      } catch {
        return null;
      }
    },
  };
}
