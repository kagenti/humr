import { basename } from "node:path";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "agent-runtime-api";
import { z } from "zod";
import { ChannelType } from "api-server-api";
import type { ChannelManager, ChannelAttachment } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { podBaseUrl } from "../../modules/agents/infrastructure/k8s.js";
import { verifyInstanceToken } from "./instance-auth.js";

const SESSION_TTL_MS = 30 * 60 * 1000;

// Defaults from packages/agent-runtime/src/modules/config.ts. Keep in sync.
// The agent-runtime files service is rooted at HOME_DIR; the agent process
// runs in WORK_DIR. attachment.path can be absolute (anywhere under HOME_DIR)
// or workspace-relative (interpreted as relative to WORK_DIR).
const AGENT_HOME_DIR = "/home/agent";
const AGENT_WORK_DIR = "/home/agent/work";

function resolveWorkspacePath(input: string): string {
  if (input.startsWith("/")) {
    return input.startsWith(`${AGENT_HOME_DIR}/`)
      ? input.slice(AGENT_HOME_DIR.length + 1)
      : input; // outside HOME_DIR — let files.read reject it
  }
  const workRel = AGENT_WORK_DIR.slice(AGENT_HOME_DIR.length + 1);
  return `${workRel}/${input}`;
}

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

function createMcpSession(
  instanceId: string,
  k8s: K8sClient,
  channelManager: ChannelManager,
): McpSession {
  const server = new McpServer({
    name: `humr-${instanceId}`,
    version: "1.0.0",
  });

  const runtimeClient = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `http://${podBaseUrl(instanceId, k8s.namespace)}/api/trpc` })],
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
    "Send a message to a connected channel (slack or telegram) for this agent instance. Pass chatId to address a specific chat (get ids from describe_channel); omit to use the last-active chat. Optionally attach a single file by setting attachment.path — accepts an absolute path on the agent pod (e.g. /home/agent/work/report.md) or a path relative to your workspace (e.g. report.md). 10 MiB cap.",
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      text: z.string(),
      chatId: z.string().optional(),
      attachment: z.object({
        path: z.string().min(1).describe("Absolute path under /home/agent or workspace-relative (e.g. report.md)."),
        filename: z.string().optional().describe("Name shown in the channel; defaults to the basename of path."),
        mimeType: z.string().optional().describe("Override the runtime-detected MIME type."),
        title: z.string().optional(),
      }).optional(),
    },
    async ({ channel, text, chatId, attachment }) => {
      let resolved: ChannelAttachment | undefined;
      if (attachment) {
        const resolvedPath = resolveWorkspacePath(attachment.path);
        let file: { content?: string; binary?: boolean; mimeType?: string };
        try {
          file = await runtimeClient.files.read.query({ path: resolvedPath });
        } catch (err) {
          const msg = err instanceof TRPCClientError && err.data?.code === "NOT_FOUND"
            ? `attachment not found: ${attachment.path} (resolved to ${resolvedPath})`
            : `failed to read attachment ${attachment.path}: ${err instanceof Error ? err.message : String(err)}`;
          return { content: [{ type: "text" as const, text: msg }], isError: true };
        }
        if (file.content === undefined) {
          return {
            content: [{ type: "text" as const, text: `attachment ${attachment.path} is too large or unreadable (runtime returned no content)` }],
            isError: true,
          };
        }
        const data = file.binary
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf8");
        resolved = {
          filename: attachment.filename ?? basename(attachment.path),
          data,
          ...(attachment.mimeType ?? file.mimeType ? { mimeType: attachment.mimeType ?? file.mimeType } : {}),
          ...(attachment.title ? { title: attachment.title } : {}),
        };
      }
      const result = await channelManager.postMessage(instanceId, channel, text, {
        ...(chatId ? { conversationId: chatId } : {}),
        ...(resolved ? { attachment: resolved } : {}),
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
    if (!await verifyInstanceToken(deps.k8s, instanceId, token)) {
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

    const session = createMcpSession(instanceId, deps.k8s, deps.channelManager);
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
