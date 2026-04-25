import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import yaml from "js-yaml";
import { ChannelType, type SkillsService } from "api-server-api";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER, LABEL_AGENT_REF, STATUS_KEY } from "../../modules/agents/infrastructure/labels.js";
import { createSkillsToolHandlers, errorResult, textResult } from "./skills-tools.js";

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

export interface McpSessionDeps {
  channelManager: ChannelManager;
  skills: SkillsService;
}

export function createMcpSession(instanceId: string, deps: McpSessionDeps): McpSession {
  const server = new McpServer({
    name: `humr-${instanceId}`,
    version: "1.0.0",
  });

  server.tool(
    "describe_channel",
    "Describe a channel on this agent instance. Returns { chats: [{ id, title }] } listing authorized chats (DMs/threads/rooms). Use the id as chatId in send_channel_message.",
    { channel: z.enum([ChannelType.Slack, ChannelType.Telegram]) },
    async ({ channel }) => {
      const chats = await deps.channelManager.listConversations(instanceId, channel);
      return textResult(JSON.stringify({ chats }));
    },
  );

  server.tool(
    "send_channel_message",
    "Send a message to a connected channel (slack or telegram) for this agent instance. Pass chatId to address a specific chat (get ids from describe_channel); omit to use the last-active chat.",
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      text: z.string(),
      chatId: z.string().optional(),
    },
    async ({ channel, text, chatId }) => {
      const result = await deps.channelManager.postMessage(instanceId, channel, text, chatId);
      if ("error" in result) return errorResult(result.error);
      return textResult("Message sent");
    },
  );

  // ---- Skills tools ---------------------------------------------------------

  const skillsTools = createSkillsToolHandlers(instanceId, deps.skills);

  server.tool(
    "list_skill_sources",
    "List the skill sources (public git repos) this instance can install from. Each entry has an id, display name, git URL, and a system flag indicating admin-managed sources.",
    {},
    () => skillsTools.listSources(),
  );

  server.tool(
    "list_skills_in_source",
    "List the skills available inside a connected skill source. Returns each skill's name, description, and the last-touching commit SHA (pass this as `version` to install_skill).",
    { sourceId: z.string() },
    (args) => skillsTools.listSkillsInSource(args),
  );

  server.tool(
    "install_skill",
    "Install a skill onto THIS running agent instance. Files land on the pod's persistent volume at the agent's configured skill path; the harness picks them up on the next session.",
    {
      source: z.string().url(),
      name: z.string().min(1),
      version: z.string().min(1),
    },
    (args) => skillsTools.installSkill(args),
  );

  server.tool(
    "uninstall_skill",
    "Uninstall a skill from THIS agent instance. Removes the directory from the pod and drops the entry from the instance spec.",
    {
      source: z.string().url(),
      name: z.string().min(1),
    },
    (args) => skillsTools.uninstallSkill(args),
  );

  server.tool(
    "publish_skill",
    "Publish a locally-authored skill from THIS instance as a pull request on a connected source. Requires the source to have a publish credential configured. Returns the PR URL on success.",
    {
      sourceId: z.string().min(1),
      name: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    },
    (args) => skillsTools.publishSkill(args),
  );

  // ---- Transport ------------------------------------------------------------

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

interface VerifiedSession {
  owner: string;
}

async function verifyAgentToken(
  k8s: K8sClient,
  instanceId: string,
  token: string,
): Promise<VerifiedSession | null> {
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
  if (hash !== status.accessTokenHash) return null;

  return { owner };
}

export interface MountMcpDeps {
  channelManager: ChannelManager;
  k8s: K8sClient;
  composeSkills: (owner: string) => SkillsService;
}

export function mountMcpRoutes(app: Hono, deps: MountMcpDeps) {
  app.all("/api/instances/:id/mcp", async (c) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = authHeader.slice(7);

    const instanceId = c.req.param("id")!;
    const verified = await verifyAgentToken(deps.k8s, instanceId, token);
    if (!verified) {
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

    const skills = deps.composeSkills(verified.owner);
    const session = createMcpSession(instanceId, {
      channelManager: deps.channelManager,
      skills,
    });
    await session.server.connect(session.transport);

    return session.transport.handleRequest(c.req.raw);
  });
}
