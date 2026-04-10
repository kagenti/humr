import type {
  Mount,
  EnvVar,
  Resources,
  SecurityContext,
  MCPServerConfig,
} from "./templates.js";

export interface AgentSpec {
  version: string;
  name: string;
  // Copied from template at creation:
  image: string;
  description?: string;
  mounts?: Mount[];
  init?: string;
  env?: EnvVar[];
  resources?: Resources;
  securityContext?: SecurityContext;
  // User-configured:
  mcpServers?: Record<string, MCPServerConfig>;
}

export interface Agent {
  id: string;
  name: string;
  templateId?: string;
  spec: AgentSpec;
}

export interface CreateAgentInput {
  name: string;
  templateId?: string;
  image?: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig>;
}

export interface UpdateAgentInput {
  id: string;
  description?: string;
  mcpServers?: Record<string, MCPServerConfig>;
}

export interface AgentsContext {
  list: () => Promise<Agent[]>;
  get: (id: string) => Promise<Agent | null>;
  create: (input: CreateAgentInput) => Promise<Agent>;
  update: (input: UpdateAgentInput) => Promise<Agent | null>;
  delete: (id: string) => Promise<void>;
}
