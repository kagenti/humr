import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter, type HarnessContext } from "harness-runtime-api";
import { createClaudeCodeAuthContext } from "./modules/claude-code-auth.js";
import { createFilesContext } from "./modules/files.js";

const PORT = Number(process.env.PORT ?? 3000);
const __dir = dirname(fileURLToPath(import.meta.url));
const isTs = import.meta.url.endsWith(".ts");
const agentScript = join(__dir, isTs ? "agent.ts" : "agent.js");
const WORKING_DIR = join(__dir, "../working-dir");

const createContext = (): HarnessContext => ({
  workingDir: WORKING_DIR,
  claudeCodeAuth: createClaudeCodeAuthContext(),
  files: createFilesContext(WORKING_DIR),
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

  if (req.url?.startsWith("/api/trpc")) {
    req.url = req.url.replace("/api/trpc", "");
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    trpcHandler(req, res);
    return;
  }

  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server, path: "/api/humr" });

wss.on("connection", (ws) => {
  const agent = isTs
    ? spawn("npx", ["tsx", agentScript], {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: WORKING_DIR,
      })
    : spawn("node", [agentScript], {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: WORKING_DIR,
      });

  let buf = "";
  agent.stdout!.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (line.trim() && ws.readyState === ws.OPEN) {
        ws.send(line);
      }
    }
  });

  ws.on("message", (data: Buffer) => {
    if (agent.stdin!.writable) {
      agent.stdin!.write(data.toString() + "\n");
    }
  });

  ws.on("close", () => agent.kill());
  agent.on("exit", () => {
    if (ws.readyState === ws.OPEN) ws.close();
  });
});

server.listen(PORT, () =>
  process.stderr.write(`Humr on http://localhost:${PORT}\n`),
);
