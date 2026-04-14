import { watch, mkdirSync, readdirSync, readFileSync, unlinkSync, existsSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { spawnAcpSession } from "./acp-bridge.js";
import { composeImprovementPrompt } from "./improvement-protocol.js";

const TriggerFile = z.object({
  schedule: z.string(),
  timestamp: z.string(),
  type: z.string().optional(),
  task: z.string().optional().default(""),
  params: z.record(z.string(), z.unknown()).optional(),
  mcpServers: z.array(z.unknown()).default([]),
});

type TriggerPayload = z.infer<typeof TriggerFile>;

interface TriggerWatcherOptions {
  triggersDir: string;
  workingDir: string;
  agentScript: string;
  isDev: boolean;
}

export interface TriggerWatcher {
  /** Number of triggers currently being processed. */
  activeCount(): number;
}

const IMPROVEMENT_LOCK = ".humr-improvement-lock";
const IMPROVEMENT_LAST = ".humr-improvement-last.json";
const IMPROVEMENT_SKIPPED = ".humr-improvement-skipped.json";
const IMPROVEMENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

type ImprovementTerminalState = "completed" | "timed-out" | "failed";

/** Write terminal outcome (completed/timed-out/failed) of an improvement run.
 * Never called for skips — those go to writeImprovementSkipped. */
function writeImprovementLast(
  workingDir: string,
  state: ImprovementTerminalState,
  schedule: string,
  detail?: string,
): void {
  const path = join(workingDir, IMPROVEMENT_LAST);
  try {
    writeFileSync(
      path,
      JSON.stringify({
        state,
        schedule,
        finishedAt: new Date().toISOString(),
        ...(detail ? { detail } : {}),
      }),
    );
  } catch (err) {
    process.stderr.write(`[trigger] Failed to write ${IMPROVEMENT_LAST}: ${err}\n`);
  }
}

/** Record the most recent skipped-trigger event. Overwriting is fine — skips
 * are transient signals, not run outcomes. Kept separate from the `last` file
 * so a skip never erases the last real run result. */
function writeImprovementSkipped(
  workingDir: string,
  schedule: string,
  reason: string,
): void {
  const path = join(workingDir, IMPROVEMENT_SKIPPED);
  try {
    writeFileSync(
      path,
      JSON.stringify({
        schedule,
        at: new Date().toISOString(),
        reason,
      }),
    );
  } catch (err) {
    process.stderr.write(`[trigger] Failed to write ${IMPROVEMENT_SKIPPED}: ${err}\n`);
  }
}

export function startTriggerWatcher(options: TriggerWatcherOptions): TriggerWatcher {
  const { triggersDir, workingDir } = options;
  const inflight = new Set<string>();

  mkdirSync(triggersDir, { recursive: true });

  // Clean up stale improvement lock on startup. If a lock file exists at boot,
  // the process that wrote it is definitely gone (we just started), so it's safe
  // to remove. This handles pod-killed-mid-run cases (redeploy, OOM, hibernation).
  const lockPath = join(workingDir, IMPROVEMENT_LOCK);
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
      process.stderr.write(`[trigger] Removed stale lock file at startup: ${lockPath}\n`);
    } catch {}
  }

  // Process any trigger files already present on startup
  for (const file of readdirSync(triggersDir)) {
    if (file.endsWith(".json")) {
      processTriggerFile(join(triggersDir, file), options);
    }
  }

  // Watch for new trigger files
  watch(triggersDir, (_event, filename) => {
    if (!filename?.endsWith(".json")) return;
    if (inflight.has(filename)) return;
    inflight.add(filename);
    const filePath = join(triggersDir, filename);
    processTriggerFile(filePath, options).finally(() => inflight.delete(filename));
  });

  process.stderr.write(`[trigger] Watching ${triggersDir}\n`);

  return { activeCount: () => inflight.size };
}

async function processTriggerFile(filePath: string, options: TriggerWatcherOptions): Promise<void> {
  if (!existsSync(filePath)) return;

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return; // File may have been picked up by another event
  }

  // Delete immediately to avoid re-pickup
  try {
    unlinkSync(filePath);
  } catch {}

  let trigger: TriggerPayload;
  try {
    trigger = TriggerFile.parse(JSON.parse(raw));
  } catch (err) {
    process.stderr.write(`[trigger] Invalid trigger file ${filePath}: ${err}\n`);
    return;
  }

  // Prevent concurrent improvement runs via atomic lock acquisition (O_CREAT|O_EXCL).
  // If the lock already exists, another run is active — skip this trigger.
  if (trigger.type === "improvement") {
    const lockPath = join(options.workingDir, IMPROVEMENT_LOCK);
    try {
      const fd = openSync(lockPath, "wx");
      const payload = JSON.stringify({ schedule: trigger.schedule, started: trigger.timestamp });
      writeFileSync(fd, payload);
      closeSync(fd);
    } catch (err: any) {
      if (err.code === "EEXIST") {
        process.stderr.write(`[trigger] Skipping improvement trigger — another run is active (${lockPath})\n`);
        writeImprovementSkipped(options.workingDir, trigger.schedule, "another run was active");
        return;
      }
      throw err;
    }
  }

  process.stderr.write(`[trigger] Picked up: ${trigger.schedule} (${trigger.timestamp})\n`);
  try {
    await runTriggerSession(trigger, options);
  } catch (err) {
    process.stderr.write(`[trigger] Session error: ${err}\n`);
  }
}

async function runTriggerSession(trigger: TriggerPayload, options: TriggerWatcherOptions): Promise<void> {
  const isImprovement = trigger.type === "improvement";
  const lockPath = join(options.workingDir, IMPROVEMENT_LOCK);
  // Lock file is already created atomically in processTriggerFile for improvement runs.

  const session = spawnAcpSession({
    agentScript: options.agentScript,
    workingDir: options.workingDir,
    isDev: options.isDev,
  });

  let requestId = 0;
  const nextId = () => ++requestId;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  session.onMessage((line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Response to our request
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
      return;
    }

    // Agent requesting permission — auto-approve (without this the agent blocks)
    if (msg.method === "session/request_permission" && msg.id !== undefined) {
      const options = msg.params?.options ?? [];
      // Pick the first "allow" option (allow_always preferred, then allow_once)
      const allowOption =
        options.find((o: any) => o.kind === "allow_always") ??
        options.find((o: any) => o.kind === "allow_once") ??
        options[0];
      if (allowOption) {
        session.send({
          jsonrpc: "2.0",
          id: msg.id,
          result: { outcome: { outcome: "selected", optionId: allowOption.optionId } },
        });
      } else {
        session.send({
          jsonrpc: "2.0",
          id: msg.id,
          result: { outcome: { outcome: "cancelled" } },
        });
      }
      return;
    }

    // Any other agent-to-client request — acknowledge so the agent doesn't hang
    if (msg.method !== undefined && msg.id !== undefined) {
      process.stderr.write(`[trigger] Unhandled agent request: ${msg.method}\n`);
      session.send({ jsonrpc: "2.0", id: msg.id, result: {} });
      return;
    }

    // Log tool calls from session/update notifications (useful for debugging and progress visibility)
    if (msg.method === "session/update" && msg.params?.update?.sessionUpdate === "tool_call") {
      const u = msg.params.update;
      process.stderr.write(`[trigger] tool: ${u.title}\n`);
      return;
    }
  });

  session.exited.then(() => {
    for (const [, { reject }] of pending) {
      reject(new Error("Agent process exited"));
    }
    pending.clear();
  });

  function rpcRequest(method: string, params: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject });
      session.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  let terminalState: ImprovementTerminalState = "completed";
  let terminalDetail: string | undefined;
  try {
    await rpcRequest("initialize", {
      clientCapabilities: {},
      clientInfo: { name: "humr-trigger", version: "1.0.0" },
      protocolVersion: 1,
    });

    const { sessionId } = await rpcRequest("session/new", {
      cwd: options.workingDir,
      mcpServers: trigger.mcpServers,
    });

    const prompt = isImprovement
      ? composeImprovementPrompt(trigger.task ?? "")
      : trigger.task ?? "";

    const promptPromise = rpcRequest("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });

    // Improvement runs get a wall-clock safety timeout. Regular cron/heartbeat
    // runs are assumed short and have no timeout.
    let timedOut = false;
    const result = isImprovement
      ? await Promise.race([
          promptPromise,
          new Promise((_, reject) =>
            setTimeout(() => {
              timedOut = true;
              reject(new Error(`improvement run exceeded timeout of ${IMPROVEMENT_TIMEOUT_MS}ms`));
            }, IMPROVEMENT_TIMEOUT_MS),
          ),
        ])
      : await promptPromise;

    if (timedOut) {
      terminalState = "timed-out";
      terminalDetail = `exceeded ${IMPROVEMENT_TIMEOUT_MS}ms`;
      process.stderr.write(`[trigger] Session ${sessionId} timed out after ${IMPROVEMENT_TIMEOUT_MS}ms\n`);
    } else {
      process.stderr.write(`[trigger] Session ${sessionId} completed: ${(result as any)?.stopReason ?? "done"}\n`);
    }
  } catch (err) {
    terminalState = "failed";
    terminalDetail = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    session.kill();
    // Release lock + record terminal state for improvement runs
    if (isImprovement) {
      try { unlinkSync(lockPath); } catch {}
      writeImprovementLast(options.workingDir, terminalState, trigger.schedule, terminalDetail);
    }
  }
}

