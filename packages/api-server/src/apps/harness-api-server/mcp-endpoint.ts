import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import yaml from "js-yaml";
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

function createMcpSession(instanceId: string, channelManager: ChannelManager): McpSession {
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

async function verifyAgentToken(k8s: K8sClient, instanceId: string, token: string): Promise<boolean> {
  const instanceCm = await k8s.getConfigMap(instanceId);
  if (!instanceCm) return false;

  const agentName = instanceCm.metadata?.labels?.[LABEL_AGENT_REF];
  const owner = instanceCm.metadata?.labels?.[LABEL_OWNER];
  if (!agentName || !owner) return false;

  const agentCm = await k8s.getConfigMap(agentName);
  if (!agentCm) return false;

  const agentOwner = agentCm.metadata?.labels?.[LABEL_OWNER];
  if (agentOwner !== owner) return false;

  const statusYaml = agentCm.data?.[STATUS_KEY];
  if (!statusYaml) return false;

  const status = yaml.load(statusYaml) as { accessTokenHash?: string };
  if (!status?.accessTokenHash) return false;

  const hash = createHash("sha256").update(token).digest("hex");
  return hash === status.accessTokenHash;
}

export function mountMcpRoutes(app: Hono, deps: {
  channelManager: ChannelManager;
  k8s: K8sClient;
}) {
  app.all("/api/instances/:id/mcp", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice(7);

    const instanceId = c.req.param("id")!;
    if (!await verifyAgentToken(deps.k8s, instanceId, token)) {
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

    const session = createMcpSession(instanceId, deps.channelManager);
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
