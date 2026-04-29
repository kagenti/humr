import { applyFile } from "./apply.js";
import { runSseLoop } from "./sse-client.js";
import type { FileSpec } from "./types.js";

export interface PodFilesSyncOptions {
  /** SSE endpoint built by the reconciler:
   *  `${HARNESS_SERVER_URL}/api/instances/<instance>/pod-files/events`. */
  url: string;
  /** Per-instance Bearer token (`ONECLI_ACCESS_TOKEN`). */
  token: string;
  /** Agent container HOME — paths in incoming FileSpecs must resolve under
   *  this prefix or the write is refused (defense-in-depth). */
  agentHome: string;
}

/**
 * Start the pod-files SSE sync loop. Mirrors `startTriggerWatcher`'s
 * shape: synchronous startup, async loop running for the rest of the
 * process's lifetime, errors logged but never crash the runtime.
 *
 * The loop dispatches "snapshot" (sent on connect) and "upsert" (sent on
 * state change) events to applyFile. Other event types are ignored.
 */
export function startPodFilesSync(opts: PodFilesSyncOptions): void {
  process.stderr.write(`[pod-files] starting (home=${opts.agentHome})\n`);
  void runSseLoop({
    url: opts.url,
    token: opts.token,
    onDispatch: (event, data) => dispatch(event, data, opts.agentHome),
  });
}

/**
 * Exported only for unit tests — exercises the JSON validation and the
 * apply loop without going through HTTP.
 */
export function dispatch(event: string, data: string, agentHome: string): void {
  if (event !== "snapshot" && event !== "upsert") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    process.stderr.write(`[pod-files] bad ${event} JSON: ${err}\n`);
    return;
  }
  const files = extractFiles(parsed);
  if (files === null) {
    process.stderr.write(
      `[pod-files] ${event} payload missing or malformed "files" array; ignored\n`,
    );
    return;
  }

  for (const file of files) {
    try {
      applyFile(file, agentHome);
    } catch (err) {
      process.stderr.write(`[pod-files] apply failed for ${file.path}: ${err}\n`);
    }
  }
}

function extractFiles(parsed: unknown): FileSpec[] | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const files = (parsed as { files?: unknown }).files;
  if (!Array.isArray(files)) return null;
  // Best-effort filter: only keep entries that look like FileSpecs. A bad
  // entry doesn't poison the rest — log it and continue.
  const out: FileSpec[] = [];
  for (const f of files) {
    if (
      f !== null &&
      typeof f === "object" &&
      typeof (f as FileSpec).path === "string" &&
      typeof (f as FileSpec).mode === "string" &&
      Array.isArray((f as FileSpec).fragments)
    ) {
      out.push(f as FileSpec);
    } else {
      process.stderr.write(`[pod-files] skipping malformed file entry: ${JSON.stringify(f)}\n`);
    }
  }
  return out;
}
