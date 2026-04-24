import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFilesService } from "../../modules/files.js";

let workingDir: string;
let svc: ReturnType<typeof createFilesService>;

beforeEach(async () => {
  workingDir = await mkdtemp(join(tmpdir(), "humr-files-"));
  svc = createFilesService(workingDir);
});

afterEach(async () => {
  // Tests create small trees; lean on afterEach cleanup via fs rm in each test.
});

async function seed(rel: string, content = "x") {
  const abs = join(workingDir, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf8");
  return abs;
}

describe("writeFileSafe mtime concurrency", () => {
  it("rejects when on-disk mtime diverges from expectedMtimeMs", async () => {
    const abs = await seed("note.md", "one");
    const { mtimeMs } = await stat(abs);

    // Simulate external write advancing mtime past what the UI observed.
    await new Promise((r) => setTimeout(r, 15));
    await writeFile(abs, "someone else wrote", "utf8");

    const result = await svc.writeFileSafe("note.md", "two", mtimeMs);
    expect("conflict" in result && result.conflict).toBe(true);
  });

  it("accepts write when expectedMtimeMs matches", async () => {
    const abs = await seed("note.md", "one");
    const { mtimeMs } = await stat(abs);

    const result = await svc.writeFileSafe("note.md", "two", mtimeMs);
    expect("mtimeMs" in result).toBe(true);
    expect(await readFile(abs, "utf8")).toBe("two");
  });

  it("skips concurrency check when expectedMtimeMs is omitted", async () => {
    await seed("note.md", "one");
    const result = await svc.writeFileSafe("note.md", "overwrite");
    expect("mtimeMs" in result).toBe(true);
  });
});

describe("EXCLUDE enforcement on write ops", () => {
  it.each([
    ".git/config",
    "node_modules/pkg/index.js",
    "work/.DS_Store",
    "work/node_modules/foo",
    ".claude.json",
  ])("rejects write into %s", async (path) => {
    await expect(svc.writeFileSafe(path, "x")).rejects.toThrow(/forbidden/);
  });

  it("rejects create into excluded segment", async () => {
    await expect(svc.createFileSafe(".git/hooks/post-commit", "#!/bin/sh")).rejects.toThrow(/forbidden/);
  });

  it("rejects rename whose source is excluded", async () => {
    await mkdir(join(workingDir, ".git"), { recursive: true });
    await writeFile(join(workingDir, ".git", "HEAD"), "ref: refs/heads/main", "utf8");
    await expect(svc.renameSafe(".git/HEAD", "HEAD", false)).rejects.toThrow(/forbidden/);
  });

  it("rejects rename whose destination is excluded", async () => {
    await seed("notes.md");
    await expect(svc.renameSafe("notes.md", ".git/notes.md", false)).rejects.toThrow(/forbidden/);
  });

  it("rejects mkdir into excluded path", async () => {
    await expect(svc.mkdirSafe("node_modules/foo")).rejects.toThrow(/forbidden/);
  });
});

describe("path traversal safety", () => {
  it.each(["../escape.txt", "work/../../escape.txt", "/etc/passwd"])(
    "rejects traversal on create: %s",
    async (path) => {
      await expect(svc.createFileSafe(path, "x")).rejects.toThrow();
    },
  );

  it("rejects traversal on delete", async () => {
    await expect(svc.deleteSafe("../escape")).rejects.toThrow();
  });
});

describe("happy paths", () => {
  it("creates a file and auto-creates parent directories", async () => {
    const result = await svc.createFileSafe("work/sub/new.md", "hi");
    expect("mtimeMs" in result).toBe(true);
    expect(await readFile(join(workingDir, "work", "sub", "new.md"), "utf8")).toBe("hi");
  });

  it("createFileSafe refuses to clobber an existing file", async () => {
    await seed("existing.md", "original");
    const result = await svc.createFileSafe("existing.md", "new");
    expect("exists" in result && result.exists).toBe(true);
    expect(await readFile(join(workingDir, "existing.md"), "utf8")).toBe("original");
  });

  it("renameSafe moves a file", async () => {
    await seed("a.md");
    const result = await svc.renameSafe("a.md", "work/b.md", false);
    expect(result).toEqual({ ok: true });
    expect(await readFile(join(workingDir, "work", "b.md"), "utf8")).toBe("x");
  });

  it("renameSafe refuses overwrite by default", async () => {
    await seed("a.md", "a");
    await seed("b.md", "b");
    const result = await svc.renameSafe("a.md", "b.md", false);
    expect("exists" in result && result.exists).toBe(true);
    expect(await readFile(join(workingDir, "b.md"), "utf8")).toBe("b");
  });

  it("renameSafe overwrites when overwrite=true", async () => {
    await seed("a.md", "a");
    await seed("b.md", "b");
    const result = await svc.renameSafe("a.md", "b.md", true);
    expect(result).toEqual({ ok: true });
    expect(await readFile(join(workingDir, "b.md"), "utf8")).toBe("a");
  });

  it("deleteSafe removes directories recursively", async () => {
    await seed("work/a.md");
    await seed("work/sub/b.md");
    await svc.deleteSafe("work");
    await expect(stat(join(workingDir, "work"))).rejects.toThrow();
  });

  it("readFileSafe returns mtimeMs for text files", async () => {
    await seed("note.md", "hello");
    const result = await svc.readFileSafe("note.md");
    expect(result).not.toBeNull();
    expect(typeof result!.mtimeMs).toBe("number");
  });

  it("uploadFileSafe writes base64 content and refuses existing path without overwrite", async () => {
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const created = await svc.uploadFileSafe("logo.png", base64, false);
    expect("mtimeMs" in created).toBe(true);
    expect((await readFile(join(workingDir, "logo.png"))).slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const rejected = await svc.uploadFileSafe("logo.png", base64, false);
    expect("exists" in rejected && rejected.exists).toBe(true);

    const replaced = await svc.uploadFileSafe("logo.png", Buffer.from("new").toString("base64"), true);
    expect("mtimeMs" in replaced).toBe(true);
    expect(await readFile(join(workingDir, "logo.png"), "utf8")).toBe("new");
  });

  it("uploadFileSafe rejects EXCLUDE paths and oversize payloads", async () => {
    await expect(svc.uploadFileSafe(".git/HEAD", "AAAA", true)).rejects.toThrow(/forbidden/);
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString("base64");
    await expect(svc.uploadFileSafe("huge.bin", huge, true)).rejects.toThrow(/too large/);
  });
});
