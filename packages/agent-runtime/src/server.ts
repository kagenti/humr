import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { WebSocketServer } from "ws";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter } from "agent-runtime-api/router";
import type { AgentRuntimeContext } from "agent-runtime-api";
import { createFilesService } from "./modules/files.js";
import { config } from "./modules/config.js";
import { composeAcp } from "./modules/acp/compose.js";
import { createWebSocketChannel } from "./modules/acp/infrastructure/create-websocket-channel.js";
import { startTriggerWatcher, type TriggerWatcher } from "./trigger-watcher.js";

let triggerWatcher: TriggerWatcher | undefined;

const __dir = dirname(fileURLToPath(import.meta.url));
const agentCommand = config.AGENT_COMMAND
  ? config.AGENT_COMMAND.split(" ")
  : config.HUMR_DEV
    ? ["npx", "tsx", join(__dir, "agent.ts")]
    : ["node", join(__dir, "agent.js")];
const homeDir = config.HUMR_DEV
  ? join(__dir, "../working-dir")
  : config.HOME_DIR;
const workDir = config.HUMR_DEV
  ? join(__dir, "../working-dir")
  : config.WORK_DIR;

const createContext = (): AgentRuntimeContext => ({
  files: createFilesService(homeDir),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 32 MB upload headroom: file-uploads go through files.upload as base64
// (≈1.34× overhead) plus JSON wrapping. The server-side FilesService caps
// decoded payloads at 10 MB, so this is purely a transport-layer guard that
// prevents partial reads before the service-level check kicks in.
const TRPC_MAX_BODY_SIZE = 32 * 1024 * 1024;

const trpcHandler = createHTTPHandler({
  router: appRouter,
  createContext,
  maxBodySize: TRPC_MAX_BODY_SIZE,
});

const { runtime: acpRuntime } = composeAcp({
  command: agentCommand,
  workingDir: workDir,
  log: (msg) => process.stderr.write(`[acp] ${msg}\n`),
});

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  if (req.url === "/api/status") {
    const s = acpRuntime.status();
    const status = {
      activeClients: s.activeClientCount,
      pendingRequests: s.pendingRequestCount,
      queuedPrompts: s.queuedPromptCount,
      agentAlive: s.agentAlive,
      activeTriggers: triggerWatcher?.activeCount() ?? 0,
    };
    res.writeHead(200, { "Content-Type": "application/json", ...CORS }).end(JSON.stringify(status));
    return;
  }

  if (req.url?.startsWith("/api/trpc")) {
    req.url = req.url.replace("/api/trpc", "");
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    trpcHandler(req, res);
    return;
  }

  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: "/api/acp" });

wss.on("connection", (ws) => {
  acpRuntime.attach(createWebSocketChannel(ws));
});

if (config.HUMR_MCP_URL) {
  const mcpPath = join(workDir, ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try { mcpConfig = JSON.parse(readFileSync(mcpPath, "utf8")); } catch {}
  }
  const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
  const mcpEntry: Record<string, unknown> = { type: "http", url: config.HUMR_MCP_URL };
  if (config.ONECLI_ACCESS_TOKEN) {
    mcpEntry.headers = { Authorization: `Bearer ${config.ONECLI_ACCESS_TOKEN}` };
  }
  mcpServers["humr-outbound"] = mcpEntry;
  mcpConfig.mcpServers = mcpServers;
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
  process.stderr.write(`[mcp] Wrote humr-outbound to ${mcpPath}\n`);
}

server.listen(config.PORT, () => {
  process.stderr.write(`Humr on http://localhost:${config.PORT}\n`);

  triggerWatcher = startTriggerWatcher({
    triggersDir: config.TRIGGERS_DIR,
    apiServerUrl: config.API_SERVER_URL,
    instanceId: process.env.ADK_INSTANCE_ID ?? process.env.HOSTNAME ?? "unknown",
  });
});
