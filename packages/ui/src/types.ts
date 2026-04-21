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

export interface ImagePart {
  kind: "image";
  data: string;       // base64-encoded
  mimeType: string;   // e.g. "image/png", "image/jpeg"
}

export interface FilePart {
  kind: "file";
  name: string;
  mimeType: string;
  /** Absent when the part is a replayed reference rather than a fresh upload — */
  /** the actual bytes only exist on the agent side. */
  data?: string;      // base64-encoded
  size?: number;
}

export interface UploadedFilePart extends FilePart {
  data: string;
  size: number;
}

export type Attachment = ImagePart | UploadedFilePart;

export type MessagePart = TextPart | ImagePart | FilePart | ToolChip;

export interface Message {
  id: string;
  role: Role;
  parts: MessagePart[];
  streaming: boolean;
  /** True while this assistant message is waiting behind an earlier in-flight
   *  prompt on the server queue. Flipped to false when the server starts
   *  streaming content to it. */
  queued?: boolean;
  /** System-style placeholder rendered as dim centered text — used for the
   *  `<clipped-conversation>` marker the runtime injects at the start of a
   *  catch-up when the session log has been truncated. Invisible to the
   *  projection's routing (findActiveAssistant skips these). */
  notice?: boolean;
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
  env?: import("api-server-api").EnvVar[];
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
  allowedUsers: string[];
}

export interface Schedule {
  id: string;
  name: string;
  instanceId: string;
  type: "cron";
  cron: string;
  task: string | null;
  enabled: boolean;
  sessionMode?: "continuous" | "fresh";
  status: { lastRun?: string; nextRun?: string; lastResult?: string } | null;
}

export type SecretType = "anthropic" | "generic";
export type SecretMode = "all" | "selective";
export type AnthropicAuthMode = "api-key" | "oauth";

/** Prefix used for MCP OAuth secrets stored in OneCLI. */
export const MCP_SECRET_PREFIX = "__humr_mcp:";

export function isMcpSecret(s: { name: string; type: SecretType }): boolean {
  return s.type !== "anthropic" && s.name.startsWith(MCP_SECRET_PREFIX);
}

/** User-visible "Secrets" — excludes the Anthropic key and MCP OAuth blobs. */
export function isCustomSecret(s: { name: string; type: SecretType }): boolean {
  return s.type !== "anthropic" && !s.name.startsWith(MCP_SECRET_PREFIX);
}

export function mcpHostnameFromSecretName(name: string): string {
  return name.startsWith(MCP_SECRET_PREFIX) ? name.slice(MCP_SECRET_PREFIX.length) : name;
}

export type { EnvMapping, EnvVar } from "api-server-api";
export {
  DEFAULT_ENV_PLACEHOLDER,
  isValidEnvName,
  ANTHROPIC_DEFAULT_ENV_MAPPING,
} from "api-server-api";

export interface SecretView {
  id: string;
  name: string;
  type: SecretType;
  hostPattern: string;
  createdAt: string;
  authMode?: AnthropicAuthMode;
  envMappings?: import("api-server-api").EnvMapping[];
}

export interface McpConnection {
  hostname: string;
  connectedAt: string;
  expired: boolean;
}
