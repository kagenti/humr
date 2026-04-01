import { join } from "node:path";
import { resolve } from "node:path";
import {
  readFileSync,
  readdirSync,
  statSync,
  watch,
} from "node:fs";
import type { FilesContext } from "harness-runtime-api";

const EXCLUDE = new Set([".git", ".claude", "node_modules", ".DS_Store"]);

function buildTree(
  dir: string,
  base = "",
): { path: string; type: "file" | "dir" }[] {
  const entries: { path: string; type: "file" | "dir" }[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(ent.name) || ent.name.startsWith(".")) continue;
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

export function createFilesContext(workingDir: string): FilesContext {
  let fileVersion = 0;
  try {
    watch(workingDir, { recursive: true }, () => {
      fileVersion++;
    });
  } catch {}

  return {
    fileVersion: () => fileVersion,
    buildTree: () => buildTree(workingDir),
    readFileSafe: (rel) => {
      if (!rel) return null;
      const abs = safePath(workingDir, rel);
      if (!abs) return null;
      try {
        const stat = statSync(abs);
        if (!stat.isFile()) return null;
        if (stat.size > 1024 * 1024) {
          return { path: rel, binary: true, version: fileVersion };
        }
        const content = readFileSync(abs, "utf8");
        return { path: rel, content, version: fileVersion };
      } catch {
        return null;
      }
    },
  };
}
