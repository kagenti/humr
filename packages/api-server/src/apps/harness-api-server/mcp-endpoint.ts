import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import yaml from "js-yaml";
import type { SchedulesService } from "api-server-api";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER, LABEL_AGENT_REF, STATUS_KEY } from "../../modules/agents/infrastructure/labels.js";

const SESSION_TTL_MS = 30 * 60 * 1000;

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  instanceId: string;
  lastActivity: number;
}

const sessions = new Map<string, McpSession>();

const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      session.transport.close?.();
      sessions.delete(id);
    }
  }
}, 5 * 60_000);
sweepInterval.unref();

interface McpSessionDeps {
  channelManager: ChannelManager;
  schedules: SchedulesService;
}

function createMcpSession(instanceId: string, deps: McpSessionDeps): McpSession {
  const { channelManager, schedules } = deps;

  const server = new McpServer({
    name: `humr-${instanceId}`,
    version: "1.0.0",
  });

  server.tool(
    "send_slack_message",
    "Send a message to the Slack channel connected to this agent instance",
    { text: z.string() },
    async ({ text }) => {
      const result = await channelManager.postMessage(instanceId, text);
      if ("error" in result) {
        return { content: [{ type: "text" as const, text: result.error }], isError: true };
      }
      return { content: [{ type: "text" as const, text: "Message sent" }] };
    },
  );

  // Schedule management: agent may only see/modify schedules belonging to its own instance.
  // Descriptions are deliberately assertive — Claude Code ships with an in-process
  // scheduled-tasks tool that would otherwise be preferred. These schedules are the
  // *persistent, platform-level* ones visible in the Humr UI.
  server.tool(
    "list_schedules",
    "List all Humr platform schedules registered for this agent instance. These are the persistent cron schedules visible in the Humr UI (not in-session or in-process cron tools).",
    {},
    async () => {
      const list = await schedules.list(instanceId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.tool(
    "create_schedule",
    "Register a PERSISTENT cron schedule on this Humr agent instance. The schedule runs on the Humr Kubernetes controller, survives Claude process restarts, shows up in the Humr UI, and fires the given prompt as a new trigger. PREFER THIS over any in-process / session-only / built-in CronCreate tool whenever the user asks to schedule recurring work on this agent — those in-process schedules die when Claude exits and are invisible to the human operator.",
    {
      name: z.string().min(1).describe("Human-readable name shown in the Humr UI"),
      cron: z.string().min(1).describe("Standard 5-field cron expression, e.g. '0 9 * * *' for 9am daily"),
      task: z.string().min(1).describe("Prompt the agent will receive when the schedule fires"),
      sessionMode: z.enum(["continuous", "fresh"]).optional().describe("continuous = resume prior session each tick; fresh = new session per run (default)"),
    },
    async ({ name, cron, task, sessionMode }) => {
      try {
        const sched = await schedules.createCron({
          name, instanceId, cron, task, sessionMode,
          createdBy: "agent",
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id: sched.id, name: sched.name, cron: sched.spec.cron, enabled: sched.spec.enabled }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "toggle_schedule",
    "Enable or disable a Humr platform schedule by id. Only affects schedules belonging to this instance.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const existing = await schedules.get(id);
      if (!existing || existing.instanceId !== instanceId) {
        return {
          content: [{ type: "text" as const, text: `schedule ${id} not found on this instance` }],
          isError: true,
        };
      }
      const updated = await schedules.toggle(id);
      if (!updated) {
        return {
          content: [{ type: "text" as const, text: `schedule ${id} not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ id: updated.id, enabled: updated.spec.enabled }, null, 2) }],
      };
    },
  );

  server.tool(
    "delete_schedule",
    "Delete a Humr platform schedule by id. Only affects schedules belonging to this instance.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const existing = await schedules.get(id);
      if (!existing || existing.instanceId !== instanceId) {
        return {
          content: [{ type: "text" as const, text: `schedule ${id} not found on this instance` }],
          isError: true,
        };
      }
      await schedules.delete(id);
      return { content: [{ type: "text" as const, text: `deleted ${id}` }] };
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      sessions.set(sessionId, session);
    },
    onsessionclosed: (sessionId: string) => {
      sessions.delete(sessionId);
    },
  });

  const session: McpSession = { transport, server, instanceId, lastActivity: Date.now() };
  return session;
}

interface AgentAuth {
  owner: string;
}

async function verifyAgentToken(k8s: K8sClient, instanceId: string, token: string): Promise<AgentAuth | null> {
  const instanceCm = await k8s.getConfigMap(instanceId);
  if (!instanceCm) return null;

  const agentName = instanceCm.metadata?.labels?.[LABEL_AGENT_REF];
  const owner = instanceCm.metadata?.labels?.[LABEL_OWNER];
  if (!agentName || !owner) return null;

  const agentCm = await k8s.getConfigMap(agentName);
  if (!agentCm) return null;

  const agentOwner = agentCm.metadata?.labels?.[LABEL_OWNER];
  if (agentOwner !== owner) return null;

  const statusYaml = agentCm.data?.[STATUS_KEY];
  if (!statusYaml) return null;

  const status = yaml.load(statusYaml) as { accessTokenHash?: string };
  if (!status?.accessTokenHash) return null;

  const hash = createHash("sha256").update(token).digest("hex");
  return hash === status.accessTokenHash ? { owner } : null;
}

export function mountMcpRoutes(app: Hono, deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
  schedulesServiceFor: (owner: string) => SchedulesService;
}) {
  app.all("/api/instances/:id/mcp", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice(7);

    const instanceId = c.req.param("id")!;
    const auth = await verifyAgentToken(deps.k8s, instanceId, token);
    if (!auth) {
      return c.json({ error: "not found" }, 404);
    }

    const sessionId = c.req.header("mcp-session-id");

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.instanceId !== instanceId) {
        return c.json({ error: "not found" }, 404);
      }
      session.lastActivity = Date.now();
      return session.transport.handleRequest(c.req.raw);
    }

    if (sessionId) {
      return c.json({ error: "session not found" }, 404);
    }

    const session = createMcpSession(instanceId, {
      channelManager: deps.channelManager,
      schedules: deps.schedulesServiceFor(auth.owner),
    });
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
