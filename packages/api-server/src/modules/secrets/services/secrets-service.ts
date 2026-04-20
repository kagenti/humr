import {
  ANTHROPIC_DEFAULT_ENV_MAPPING,
  type SecretsService,
  type CreateSecretInput,
  type UpdateSecretInput,
  type SecretType,
  type SecretView,
  type AgentAccess,
  type EnvMapping,
  type InjectionConfig,
} from "api-server-api";
import type {
  OnecliSecret,
  OnecliSecretsPort,
} from "./../infrastructure/onecli-secrets-port.js";
import { hostPatternFor } from "../domain/types.js";

/** Once per process: Anthropic secret IDs we've already attempted to backfill. Prevents N writes per list() call. */
const backfilled = new Set<string>();

function toSecretView(s: OnecliSecret): SecretView {
  const type = (s.type === "anthropic" ? "anthropic" : "generic") as SecretType;
  return {
    id: s.id,
    name: s.name,
    type,
    hostPattern: s.hostPattern,
    ...(s.pathPattern ? { pathPattern: s.pathPattern } : {}),
    ...(type === "generic" && s.injectionConfig
      ? { injectionConfig: s.injectionConfig }
      : {}),
    createdAt: s.createdAt,
    ...(type === "anthropic" && s.metadata?.authMode
      ? { authMode: s.metadata.authMode }
      : {}),
    ...(s.metadata?.envMappings
      ? { envMappings: s.metadata.envMappings }
      : {}),
  };
}

export function createSecretsService(deps: {
  port: OnecliSecretsPort;
}): SecretsService {
  return {
    async list() {
      const secrets = await deps.port.listSecrets();

      // Anthropic secrets predating envMappings get the default mapping attached
      // so the controller can inject CLAUDE_CODE_OAUTH_TOKEN without a migration job.
      // Awaited so the response and OneCLI state agree — the controller reads
      // OneCLI directly and cannot observe a fire-and-forget PATCH in flight.
      for (const s of secrets) {
        if (
          s.type !== "anthropic" ||
          s.metadata?.envMappings ||
          backfilled.has(s.id)
        ) {
          continue;
        }
        backfilled.add(s.id);
        try {
          await deps.port.updateSecret(s.id, {
            envMappings: [ANTHROPIC_DEFAULT_ENV_MAPPING],
          });
          s.metadata = {
            ...(s.metadata ?? {}),
            envMappings: [ANTHROPIC_DEFAULT_ENV_MAPPING],
          };
        } catch {
          backfilled.delete(s.id);
        }
      }

      return secrets.map(toSecretView);
    },

    async create(input: CreateSecretInput) {
      const hp = hostPatternFor(input.type, input.hostPattern);
      const envMappings =
        input.envMappings ??
        (input.type === "anthropic" ? [ANTHROPIC_DEFAULT_ENV_MAPPING] : undefined);
      const created = await deps.port.createSecret({
        name: input.name,
        type: input.type,
        value: input.value,
        hostPattern: hp,
        ...(input.pathPattern ? { pathPattern: input.pathPattern } : {}),
        ...(input.injectionConfig ? { injectionConfig: input.injectionConfig } : {}),
        ...(envMappings ? { envMappings } : {}),
      });
      // OneCLI may not echo metadata on create; fall back to the request's envMappings.
      if (!created.metadata?.envMappings && envMappings) {
        created.metadata = { ...(created.metadata ?? {}), envMappings };
      }
      return toSecretView(created);
    },

    async update(input: UpdateSecretInput) {
      const patch: {
        name?: string;
        value?: string;
        pathPattern?: string | null;
        injectionConfig?: InjectionConfig | null;
        envMappings?: EnvMapping[];
      } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.value !== undefined) patch.value = input.value;
      if (input.pathPattern !== undefined) patch.pathPattern = input.pathPattern;
      if (input.injectionConfig !== undefined) patch.injectionConfig = input.injectionConfig;
      if (input.envMappings !== undefined) patch.envMappings = input.envMappings;
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
