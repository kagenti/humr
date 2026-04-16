import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ChannelManager } from "./modules/channels/services/ChannelManager.js";
import type { InstancesRepository } from "./modules/agents/infrastructure/InstancesRepository.js";

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

const sessions = new Map<string, McpSession>();

function createMcpSession(instanceId: string, channelManager: ChannelManager): McpSession {
  const server = new McpServer({
    name: `humr-${instanceId}`,
    version: "1.0.0",
  });

  server.tool(
    "send_slack_message",
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

  const session: McpSession = { transport, server };
  return session;
}

export function createMcpRoutes(deps: {
  channelManager: ChannelManager;
  instancesRepo: InstancesRepository;
  internalToken?: string;
}) {
  const app = new Hono();

  app.all("/api/instances/:id/mcp", async (c) => {
    const token = c.req.header("x-humr-token");
    if (!deps.internalToken || token !== deps.internalToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const instanceId = c.req.param("id")!;
    if (!await deps.instancesRepo.get(instanceId)) {
      return c.json({ error: "not found" }, 404);
    }

    const sessionId = c.req.header("mcp-session-id");

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      return session.transport.handleRequest(c.req.raw);
    }

    if (sessionId) {
      return c.json({ error: "session not found" }, 404);
    }

    const session = createMcpSession(instanceId, deps.channelManager);
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });

  return app;
}
