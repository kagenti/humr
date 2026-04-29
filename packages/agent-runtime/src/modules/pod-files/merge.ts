import yaml from "js-yaml";
import type { Fragment } from "./types.js";

/**
 * Apply fragments to existing YAML content using fill-if-missing semantics:
 * new top-level keys are added; existing keys whose value is a mapping have
 * their missing fields filled. Never overwrites a present field; never
 * deletes anything.
 *
 * Returns `changed: false` and the original input verbatim when nothing
 * actually changes — the caller can then skip the write entirely. When
 * `changed: true` the output is re-serialized; comments and exact
 * formatting in unchanged sections are not preserved (js-yaml limitation;
 * acceptable for the gh hosts.yml case and any future producer that
 * doesn't rely on user-authored comments). Image-baked content under the
 * top-level keys we don't touch is preserved by value, since fill-if-
 * missing never reads or rewrites those keys.
 */
export function mergeYAMLFillIfMissing(
  existing: string,
  fragments: Fragment[],
): { merged: string; changed: boolean } {
  let root: Record<string, unknown> = {};
  if (existing.trim().length > 0) {
    const parsed = yaml.load(existing);
    if (isPlainObject(parsed)) {
      root = parsed;
    }
    // null, scalars, arrays at the top level are treated as empty and
    // rebuilt — fill-if-missing requires a mapping at the root.
  }

  let changed = false;
  for (const f of fragments) {
    for (const [key, value] of Object.entries(f)) {
      if (!key) continue;
      if (mergeKey(root, key, value)) changed = true;
    }
  }

  if (!changed) return { merged: existing, changed: false };
  return { merged: yaml.dump(root, { indent: 4 }), changed: true };
}

function mergeKey(
  root: Record<string, unknown>,
  key: string,
  value: unknown,
): boolean {
  if (!(key in root)) {
    root[key] = value;
    return true;
  }
  const existing = root[key];
  if (!isPlainObject(value) || !isPlainObject(existing)) return false;
  let changed = false;
  for (const [k, v] of Object.entries(value)) {
    if (k in existing) continue;
    existing[k] = v;
    changed = true;
  }
  return changed;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
