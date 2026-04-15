import type { McpServer } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";

export type Role = "user" | "assistant";

export interface ToolContent {
  type: "content" | "diff" | "terminal";
  text?: string;
}

export interface ToolChip {
  kind: "tool";
  toolCallId?: string;
  title: string;
  status: string;
  content?: ToolContent[];
}

export interface TextPart {
  kind: "text";
  text: string;
}

export type MessagePart = TextPart | ToolChip;

export interface Message {
  id: string;
  role: Role;
  parts: MessagePart[];
  streaming: boolean;
}

export interface LogEntry {
  id: string;
  ts: string;
  type: string;
  payload: object;
}

export { SessionType } from "api-server-api";
export type { SessionView } from "api-server-api";

export interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

export interface MCPServerConfig {
  type: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
}

export interface TemplateView {
  id: string;
  name: string;
  image: string;
  description?: string;
}

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  image: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig> | null;
}

export type InstanceState = "starting" | "running" | "hibernating" | "hibernated" | "error";

export interface InstanceView {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  state: InstanceState;
  error?: string;
  channels: { type: string; slackChannelId: string }[];
  enabledMcpServers: string[];
}

export interface Schedule {
  id: string;
  name: string;
  instanceId: string;
  type: "heartbeat" | "cron";
  cron: string;
  task: string | null;
  enabled: boolean;
  status: { lastRun?: string; nextRun?: string; lastResult?: string } | null;
}

export interface McpFormEntry {
  id: string;
  name: string;
  type: "stdio" | "http";
  command: string;
  args: string;
  url: string;
}

export interface McpConnection {
  hostname: string;
  connectedAt: string;
  expired: boolean;
}

/** Resolve enabled MCP servers from agent config + instance enabled list. */
export function resolveAcpMcpServers(
  agents: AgentView[],
  instance?: InstanceView | null,
): McpServer[] {
  if (!instance) return [];
  const agent = agents.find((a) => a.id === instance.agentId);
  if (!agent?.mcpServers) return [];
  const enabled = instance.enabledMcpServers;
  const entries = enabled
    ? Object.entries(agent.mcpServers).filter(([name]) => enabled.includes(name))
    : Object.entries(agent.mcpServers);
  return entries.map(([name, s]): McpServer => {
    if (s.type === "http") {
      return { type: "http", name, url: s.url!, headers: [] };
    }
    return { command: s.command!, args: s.args ?? [], env: [], name };
  });
}
