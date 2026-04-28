import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import yaml from "js-yaml";
import { ChannelType } from "api-server-api";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER, LABEL_AGENT_REF, STATUS_KEY } from "../../modules/agents/infrastructure/labels.js";

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

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
    "describe_channel",
    "Describe a channel on this agent instance. Returns { chats: [{ id, title }] } listing authorized chats (DMs/threads/rooms). Use the id as chatId in send_channel_message.",
    { channel: z.enum([ChannelType.Slack, ChannelType.Telegram]) },
    async ({ channel }) => {
      const chats = await channelManager.listConversations(instanceId, channel);
      return { content: [{ type: "text" as const, text: JSON.stringify({ chats }) }] };
    },
  );

  server.tool(
    "send_channel_message",
    "Send a message to a connected channel (slack or telegram) for this agent instance. Pass chatId to address a specific chat (get ids from describe_channel); omit to use the last-active chat. Optionally include a single file attachment (max 10 MiB) — pass the binary as base64 in attachment.content.",
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      text: z.string(),
      chatId: z.string().optional(),
      attachment: z.object({
        filename: z.string().min(1),
        content: z.string().min(1).describe("File contents encoded as base64."),
        mimeType: z.string().optional(),
        title: z.string().optional(),
      }).optional(),
    },
    async ({ channel, text, chatId, attachment }) => {
      let decoded: Buffer | undefined;
      if (attachment) {
        decoded = Buffer.from(attachment.content, "base64");
        if (decoded.length === 0) {
          return { content: [{ type: "text" as const, text: "attachment.content decoded to zero bytes (invalid base64?)" }], isError: true };
        }
        if (decoded.length > MAX_ATTACHMENT_BYTES) {
          return {
            content: [{ type: "text" as const, text: `attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes` }],
            isError: true,
          };
        }
      }
      const result = await channelManager.postMessage(instanceId, channel, text, {
        ...(chatId ? { conversationId: chatId } : {}),
        ...(decoded ? {
          attachment: {
            filename: attachment!.filename,
            data: decoded,
            ...(attachment!.mimeType ? { mimeType: attachment!.mimeType } : {}),
            ...(attachment!.title ? { title: attachment!.title } : {}),
          },
        } : {}),
      });
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
