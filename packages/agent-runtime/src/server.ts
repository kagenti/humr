import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
<<<<<<< HEAD:packages/harness-runtime/src/index.ts
import { appRouter, type HarnessContext } from "harness-runtime-api";
=======
import { appRouter, type AgentRuntimeContext } from "agent-runtime-api";
import { createClaudeCodeAuthContext } from "./modules/claude-code-auth.js";
>>>>>>> 2db88ce (filewatcher trigger sessions):packages/agent-runtime/src/server.ts
import { createFilesContext } from "./modules/files.js";
import { config } from "./modules/config.js";
import { spawnAcpSession } from "./acp-bridge.js";
import { startTriggerWatcher } from "./trigger-watcher.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const agentScript = join(__dir, config.HUMR_DEV ? "agent.ts" : "agent.js");
const workingDir = config.HUMR_DEV
  ? join(__dir, "../working-dir")
  : config.WORKSPACE_DIR;

<<<<<<< HEAD:packages/harness-runtime/src/index.ts
const createContext = (): HarnessContext => ({
  files: createFilesContext(WORKING_DIR),
=======
const createContext = (): AgentRuntimeContext => ({
  claudeCodeAuth: createClaudeCodeAuthContext(),
  files: createFilesContext(workingDir),
>>>>>>> 2db88ce (filewatcher trigger sessions):packages/agent-runtime/src/server.ts
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const trpcHandler = createHTTPHandler({
  router: appRouter,
  createContext,
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
<<<<<<< HEAD:packages/harness-runtime/src/index.ts
  const agentEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: "placeholder" };
  const agent = config.HUMR_DEV
    ? spawn("npx", ["tsx", agentScript], {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: WORKING_DIR,
        env: agentEnv,
      })
    : spawn("node", [agentScript], {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: WORKING_DIR,
        env: agentEnv,
      });
=======
  const session = spawnAcpSession({ agentScript, workingDir, isDev: config.HUMR_DEV });
>>>>>>> 2db88ce (filewatcher trigger sessions):packages/agent-runtime/src/server.ts

  session.onMessage((line) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(line);
    }
  });

  ws.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.params?.cwd !== undefined) {
        msg.params.cwd = workingDir;
      }
      session.send(msg);
    } catch {
      process.stderr.write(`[acp] Dropping non-JSON WebSocket message: ${data.toString()}\n`);
    }
  });

  ws.on("close", () => session.kill());
  session.exited.then(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });
});

server.listen(config.PORT, () => {
  process.stderr.write(`Humr on http://localhost:${config.PORT}\n`);

  startTriggerWatcher({
    triggersDir: config.TRIGGERS_DIR,
    workingDir,
    agentScript,
    isDev: config.HUMR_DEV,
  });
});
