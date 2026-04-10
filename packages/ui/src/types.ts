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

export interface SessionInfo {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

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
  name: string;
  image: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig> | null;
}

export interface InstanceView {
  name: string;
  templateName: string;
  description?: string;
  desiredState: "running" | "hibernated";
  enabledMcpServers?: string[] | null;
  slackConnected: boolean;
  status: { currentState: string; error?: string; podReady: boolean } | null;
}

export interface Schedule {
  name: string;
  instanceName: string;
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

/** Resolve enabled MCP servers from template config + instance enabled list. */
export function resolveAcpMcpServers(
  templates: TemplateView[],
  instance?: InstanceView | null,
): McpServer[] {
  if (!instance) return [];
  const tmpl = templates.find((t) => t.name === instance.templateName);
  if (!tmpl?.mcpServers) return [];
  const enabled = instance.enabledMcpServers;
  const entries = enabled
    ? Object.entries(tmpl.mcpServers).filter(([name]) => enabled.includes(name))
    : Object.entries(tmpl.mcpServers);
  return entries.map(([name, s]): McpServer => {
    if (s.type === "http") {
      return { type: "http", name, url: s.url!, headers: [] };
    }
    return { command: s.command!, args: s.args ?? [], env: [], name };
  });
}
