export interface FileReadResult {
  path: string;
  content?: string;  // UTF-8 for text, base64 for binary
  binary?: boolean;  // true when content is base64-encoded or file exceeds size limit
  mimeType?: string; // detected MIME type (absent when file exceeds size limit)
  mtimeMs?: number;  // mtime at read; absent when file exceeds size limit
}

export interface FileWriteOk {
  mtimeMs: number;
  /** Absolute on-pod path. Exposed for callers (e.g., chat-message uploads)
   *  that need to hand the path to the agent as a `file://` URI. */
  absolutePath?: string;
}

export interface FileConflict {
  conflict: true;
  currentMtimeMs: number;
}

export interface PathExists {
  exists: true;
}

export interface FilesService {
  buildTree: () => { path: string; type: "file" | "dir" }[];
  readFileSafe: (rel: string) => Promise<FileReadResult | null>;
  /** Overwrite an existing file. Returns conflict when expectedMtimeMs is
   *  provided and the file was modified in the meantime. */
  writeFileSafe: (
    rel: string,
    content: string,
    expectedMtimeMs?: number,
  ) => Promise<FileWriteOk | FileConflict>;
  /** Create a new file. Fails with `{exists: true}` when the path already
   *  exists. Auto-creates missing parent directories. */
  createFileSafe: (rel: string, content: string) => Promise<FileWriteOk | PathExists>;
  /** Create a directory (recursive mkdir). Returns `{exists: true}` if the
   *  path already exists and is not a directory. */
  mkdirSafe: (rel: string) => Promise<{ ok: true } | PathExists>;
  /** Move/rename a file or directory. Returns `{exists: true}` when the
   *  destination exists and overwrite is false. */
  renameSafe: (
    from: string,
    to: string,
    overwrite: boolean,
  ) => Promise<{ ok: true } | PathExists>;
  /** Remove a file or directory (recursive for dirs). */
  deleteSafe: (rel: string) => Promise<{ ok: true }>;
  /** Write a binary payload (base64-encoded) to disk. When `overwrite` is
   *  false and the destination exists, returns `{exists: true}` without
   *  clobbering. Intended for UI uploads where the client has no prior mtime. */
  uploadFileSafe: (
    rel: string,
    base64: string,
    overwrite: boolean,
  ) => Promise<FileWriteOk | PathExists>;
}
