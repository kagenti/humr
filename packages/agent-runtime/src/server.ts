import http from "node:http";
import { spawnSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { WebSocketServer } from "ws";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter } from "agent-runtime-api/router";
import type { AgentRuntimeContext } from "agent-runtime-api";
import { createFilesService } from "./modules/files.js";
import {
  installSkill,
  installSkillInputSchema,
  listLocalSkills,
  PayloadTooLargeError,
  publishSkill,
  readLocalSkill,
  uninstallSkill,
  uninstallSkillInputSchema,
} from "./modules/skills.js";
import { z } from "zod/v4";

const publishSkillInputSchema = z.object({
  name: z.string().min(1),
  skillPaths: z.array(z.string().min(1)).min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
});
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

const MAX_BODY_BYTES = 1_000_000;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS }).end(JSON.stringify(body));
}

/**
 * Check Authorization: Bearer <token> against the agent's own access token
 * (the same value stored in the agent-token Secret and written to .mcp.json on
 * boot). Returns true only when both are configured and match. Constant-time.
 */
function isAuthorizedAgentCaller(req: http.IncomingMessage): boolean {
  const expected = config.ONECLI_ACCESS_TOKEN;
  if (!expected) return false;
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const trpcHandler = createHTTPHandler({
  router: appRouter,
  createContext,
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

  if (req.url?.startsWith("/api/skills/local") && req.method === "GET") {
    if (!isAuthorizedAgentCaller(req)) {
      writeJson(res, 401, { error: "unauthorized" });
      return;
    }
    (async () => {
      const url = new URL(req.url!, "http://localhost");
      const skillPaths = url.searchParams.getAll("skillPaths");
      if (skillPaths.length === 0) {
        writeJson(res, 400, { error: "skillPaths query parameter required" });
        return;
      }

      // /api/skills/local → list; /api/skills/local/<name> → read a single skill.
      const tail = url.pathname.replace(/^\/api\/skills\/local\/?/, "");
      if (!tail) {
        try {
          const skills = await listLocalSkills(skillPaths);
          writeJson(res, 200, { skills });
        } catch (err) {
          writeJson(res, 500, { error: (err as Error).message });
        }
        return;
      }

      const name = decodeURIComponent(tail);
      try {
        const result = await readLocalSkill(name, skillPaths);
        writeJson(res, 200, result);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          writeJson(res, 413, { error: err.message });
          return;
        }
        const msg = (err as Error).message;
        if (msg.includes("not found")) {
          writeJson(res, 404, { error: msg });
          return;
        }
        writeJson(res, 500, { error: msg });
      }
    })().catch((err) => writeJson(res, 400, { error: (err as Error).message }));
    return;
  }

  if (req.url === "/api/skills/install" && req.method === "POST") {
    if (!isAuthorizedAgentCaller(req)) {
      writeJson(res, 401, { error: "unauthorized" });
      return;
    }
    (async () => {
      const body = await readJsonBody(req);
      const parsed = installSkillInputSchema.safeParse(body);
      if (!parsed.success) {
        writeJson(res, 400, { error: parsed.error.message });
        return;
      }
      try {
        await installSkill(parsed.data);
        writeJson(res, 200, { ok: true });
      } catch (err) {
        writeJson(res, 500, { error: (err as Error).message });
      }
    })().catch((err) => writeJson(res, 400, { error: (err as Error).message }));
    return;
  }

  if (req.url === "/api/skills/publish" && req.method === "POST") {
    if (!isAuthorizedAgentCaller(req)) {
      writeJson(res, 401, { error: "unauthorized" });
      return;
    }
    (async () => {
      const body = await readJsonBody(req);
      const parsed = publishSkillInputSchema.safeParse(body);
      if (!parsed.success) {
        writeJson(res, 400, { error: parsed.error.message });
        return;
      }
      try {
        const result = await publishSkill(parsed.data);
        writeJson(res, 200, result);
      } catch (err) {
        const e = err as Error & { cause?: { status?: number; body?: unknown } };
        // OneCLI structured errors get relayed verbatim so the api-server (and
        // UI) can extract connect_url / manage_url.
        const cause = e.cause;
        if (cause && typeof cause === "object" && typeof cause.status === "number") {
          writeJson(res, 502, { error: e.message, upstream: cause });
          return;
        }
        writeJson(res, 500, { error: e.message });
      }
    })().catch((err) => writeJson(res, 400, { error: (err as Error).message }));
    return;
  }

  if (req.url === "/api/skills/uninstall" && req.method === "POST") {
    if (!isAuthorizedAgentCaller(req)) {
      writeJson(res, 401, { error: "unauthorized" });
      return;
    }
    (async () => {
      const body = await readJsonBody(req);
      const parsed = uninstallSkillInputSchema.safeParse(body);
      if (!parsed.success) {
        writeJson(res, 400, { error: parsed.error.message });
        return;
      }
      try {
        await uninstallSkill(parsed.data);
        writeJson(res, 200, { ok: true });
      } catch (err) {
        writeJson(res, 500, { error: (err as Error).message });
      }
    })().catch((err) => writeJson(res, 400, { error: (err as Error).message }));
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

// Configure git to use gh's credential helper. git doesn't know about
// GH_TOKEN directly, so without this it prompts for a username on private
// repos. With this, git asks `gh auth git-credential`, gets humr:sentinel,
// and OneCLI's MITM swaps it — same path REST already uses. Idempotent;
// safe to run on every boot.
try {
  const result = spawnSync("gh", ["auth", "setup-git"], { stdio: "pipe" });
  if (result.status !== 0) {
    process.stderr.write(
      `[git] gh auth setup-git exited ${result.status}: ${result.stderr?.toString() ?? ""}\n`,
    );
  }
} catch (err) {
  process.stderr.write(`[git] failed to configure credential helper: ${(err as Error).message}\n`);
}

server.listen(config.PORT, () => {
  process.stderr.write(`Humr on http://localhost:${config.PORT}\n`);

  triggerWatcher = startTriggerWatcher({
    triggersDir: config.TRIGGERS_DIR,
    apiServerUrl: config.API_SERVER_URL,
    instanceId: process.env.ADK_INSTANCE_ID ?? process.env.HOSTNAME ?? "unknown",
  });
});
