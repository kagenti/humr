export type SecretType = "anthropic" | "generic";

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
 * OAuth-token mode. The Claude Code SDK sends `CLAUDE_CODE_OAUTH_TOKEN` via
 * `Authorization: Bearer …`, which OneCLI's MITM gateway swaps for the stored
 * OAuth credential.
 */
export const ANTHROPIC_OAUTH_ENV_MAPPING: EnvMapping = {
  envName: "CLAUDE_CODE_OAUTH_TOKEN",
  placeholder: DEFAULT_ENV_PLACEHOLDER,
};

/**
 * API-key mode. Tools that read `ANTHROPIC_API_KEY` (e.g. `@anthropic-ai/sdk`)
 * send the sentinel via `x-api-key`, which OneCLI's gateway swaps for the
 * stored api-key credential.
 */
export const ANTHROPIC_API_KEY_ENV_MAPPING: EnvMapping = {
  envName: "ANTHROPIC_API_KEY",
  placeholder: DEFAULT_ENV_PLACEHOLDER,
};

export interface SecretView {
  id: string;
  name: string;
  type: SecretType;
  hostPattern: string;
  createdAt: string;
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
