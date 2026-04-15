export type SecretType = "anthropic" | "generic";

/** Anthropic auth style — detected by OneCLI from the value prefix. */
export type AnthropicAuthMode = "api-key" | "oauth";

export type SecretMode = "all" | "selective";

export interface SecretView {
  id: string;
  name: string;
  type: SecretType;
  hostPattern: string;
  createdAt: string;
  /** Only set for type="anthropic" — reflects the OneCLI-detected auth mode. */
  authMode?: AnthropicAuthMode;
}

export interface CreateSecretInput {
  type: SecretType;
  name: string;
  value: string;
  hostPattern?: string;
}

export interface UpdateSecretInput {
  id: string;
  name?: string;
  value?: string;
}

export interface AgentAccess {
  mode: SecretMode;
  secretIds: string[];
}

export interface SecretsService {
  list(): Promise<SecretView[]>;
  create(input: CreateSecretInput): Promise<SecretView>;
  update(input: UpdateSecretInput): Promise<void>;
  delete(id: string): Promise<void>;
  getAgentAccess(agentName: string): Promise<AgentAccess>;
  setAgentAccess(agentName: string, access: AgentAccess): Promise<void>;
}
