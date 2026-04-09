import { watch, mkdirSync, readdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import { spawnAcpSession } from "./acp-bridge.js";

const TriggerFile = z.object({
  schedule: z.string(),
  timestamp: z.string(),
  prompt: z.string(),
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

export function startTriggerWatcher(options: TriggerWatcherOptions): void {
  const { triggersDir } = options;
  const inflight = new Set<string>();

  mkdirSync(triggersDir, { recursive: true });

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

  process.stderr.write(`[trigger] Picked up: ${trigger.schedule} (${trigger.timestamp})\n`);
  try {
    await runTriggerSession(trigger, options);
  } catch (err) {
    process.stderr.write(`[trigger] Session error: ${err}\n`);
  }
}

async function runTriggerSession(trigger: TriggerPayload, options: TriggerWatcherOptions): Promise<void> {
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
      session.send({ jsonrpc: "2.0", id: msg.id, result: { outcome: "approved" } });
      return;
    }

    // Any other agent-to-client request — acknowledge so the agent doesn't hang
    if (msg.method !== undefined && msg.id !== undefined) {
      process.stderr.write(`[trigger] Unhandled agent request: ${msg.method}\n`);
      session.send({ jsonrpc: "2.0", id: msg.id, result: {} });
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

    const result = await rpcRequest("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: trigger.prompt }],
    });

    process.stderr.write(`[trigger] Session ${sessionId} completed: ${result.stopReason ?? "done"}\n`);
  } finally {
    session.kill();
  }
}
