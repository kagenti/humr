import type {
  SecretsService,
  CreateSecretInput,
  UpdateSecretInput,
  SecretType,
  AnthropicAuthMode,
  AgentAccess,
} from "api-server-api";
import type { OnecliSecretsPort } from "./../infrastructure/onecli-secrets-port.js";
import { ANTHROPIC_HOST_PATTERN, hostPatternFor } from "../domain/types.js";

function secretTypeFor(input: {
  type: string;
  hostPattern: string;
}): SecretType {
  if (input.type === "anthropic" || input.hostPattern === ANTHROPIC_HOST_PATTERN) {
    return "anthropic";
  }
  return "generic";
}

function authModeFor(input: {
  hostPattern: string;
  metadata?: { authMode?: AnthropicAuthMode } | null;
  injectionConfig?: { headerName?: string; valueFormat?: string } | null;
}): AnthropicAuthMode | undefined {
  if (input.hostPattern !== ANTHROPIC_HOST_PATTERN) return undefined;
  if (input.metadata?.authMode) return input.metadata.authMode;

  const headerName = input.injectionConfig?.headerName?.toLowerCase();
  if (headerName === "authorization") return "oauth";
  if (headerName === "x-api-key") return "api-key";
  return undefined;
}

export function createSecretsService(deps: {
  port: OnecliSecretsPort;
}): SecretsService {
  return {
    async list() {
      const secrets = await deps.port.listSecrets();
      return secrets.map((s) => {
        const type = secretTypeFor(s);
        const authMode = authModeFor(s);
        return {
          id: s.id,
          name: s.name,
          type,
          hostPattern: s.hostPattern,
          createdAt: s.createdAt,
          ...(type === "anthropic" && authMode ? { authMode } : {}),
        };
      });
    },

    async create(input: CreateSecretInput) {
      const hp = hostPatternFor(input.type, input.hostPattern);
      const created = await deps.port.createSecret({
        name: input.name,
        type: input.type,
        value: input.value,
        hostPattern: hp,
      });
      return {
        id: created.id,
        name: created.name,
        type: input.type,
        hostPattern: created.hostPattern,
        createdAt: created.createdAt,
        ...(input.type === "anthropic" && authModeFor(created)
          ? { authMode: authModeFor(created) }
          : {}),
      };
    },

    async update(input: UpdateSecretInput) {
      const patch: Record<string, string> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.value !== undefined) patch.value = input.value;
      await deps.port.updateSecret(input.id, patch);
    },

    delete: (id) => deps.port.deleteSecret(id),

    async getAgentAccess(agentName: string) {
      const agent = await deps.port.findAgentByIdentifier(agentName);
      if (!agent) throw new Error(`Agent "${agentName}" not found in OneCLI`);
      const secretIds = await deps.port.getAgentSecrets(agent.id);
      return { mode: agent.secretMode, secretIds };
    },

    async setAgentAccess(agentName: string, access: AgentAccess) {
      const agent = await deps.port.findAgentByIdentifier(agentName);
      if (!agent) throw new Error(`Agent "${agentName}" not found in OneCLI`);
      if (agent.secretMode !== access.mode) {
        await deps.port.setAgentSecretMode(agent.id, access.mode);
      }
      // Always update the list — the selective list is stored even in "all" mode
      // so the user's selection is preserved across toggles.
      await deps.port.setAgentSecrets(agent.id, access.secretIds);
    },
  };
}
