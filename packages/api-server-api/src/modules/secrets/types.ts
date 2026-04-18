export type SecretType = "anthropic" | "generic";

/** Anthropic auth style — detected by OneCLI from the value prefix. */
export type AnthropicAuthMode = "api-key" | "oauth";

export type SecretMode = "all" | "selective";

/**
 * Declares a pod env var to inject into every agent instance that has access
 * to this secret. `placeholder` is the literal value written into the env
 * (typically "humr:sentinel") — OneCLI's gateway swaps it for the real
 * credential on outbound requests matching the secret's host pattern.
 */
export interface EnvMapping {
  envName: string;
  placeholder: string;
}

export const DEFAULT_ENV_PLACEHOLDER = "humr:sentinel";

export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidEnvName(name: string): boolean {
  return name.length > 0 && ENV_NAME_RE.test(name);
}

/**
 * Default env mapping auto-attached to new Anthropic connectors.
 *
 * Uses `CLAUDE_CODE_OAUTH_TOKEN` so the Claude Code SDK sends the sentinel in
 * `Authorization: Bearer …`, matching the routing OneCLI's MITM gateway is set
 * up to swap. Routing via `ANTHROPIC_API_KEY` (`x-api-key`) does not work for
 * OAuth-type credentials, which is the common case here.
 */
export const ANTHROPIC_DEFAULT_ENV_MAPPING: EnvMapping = {
  envName: "CLAUDE_CODE_OAUTH_TOKEN",
  placeholder: DEFAULT_ENV_PLACEHOLDER,
};

export interface SecretView {
  id: string;
  name: string;
  type: SecretType;
  hostPattern: string;
  createdAt: string;
  /** Only set for type="anthropic" — reflects the OneCLI-detected auth mode. */
  authMode?: AnthropicAuthMode;
  envMappings?: EnvMapping[];
}

export interface CreateSecretInput {
  type: SecretType;
  name: string;
  value: string;
  hostPattern?: string;
  envMappings?: EnvMapping[];
}

export interface UpdateSecretInput {
  id: string;
  name?: string;
  value?: string;
  envMappings?: EnvMapping[];
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
