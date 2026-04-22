import {
  ANTHROPIC_API_KEY_ENV_MAPPING,
  ANTHROPIC_OAUTH_ENV_MAPPING,
  type SecretsService,
  type CreateSecretInput,
  type UpdateSecretInput,
  type SecretType,
  type SecretView,
  type AgentAccess,
} from "api-server-api";
import type {
  OnecliSecret,
  OnecliSecretsPort,
} from "./../infrastructure/onecli-secrets-port.js";
import { hostPatternFor } from "../domain/types.js";

/** Once per process: Anthropic secret IDs we've already attempted to backfill. Prevents N writes per list() call. */
const backfilled = new Set<string>();

function toSecretView(s: OnecliSecret): SecretView {
  const type: SecretType = s.type === "anthropic" ? "anthropic" : "generic";
  const view: SecretView = {
    id: s.id,
    name: s.name,
    type,
    hostPattern: s.hostPattern,
    createdAt: s.createdAt,
  };
  if (s.pathPattern) view.pathPattern = s.pathPattern;
  if (type === "generic" && s.injectionConfig) view.injectionConfig = s.injectionConfig;
  if (type === "anthropic" && s.metadata?.authMode) view.authMode = s.metadata.authMode;
  if (s.metadata?.envMappings) view.envMappings = s.metadata.envMappings;
  return view;
}

export function createSecretsService(deps: {
  port: OnecliSecretsPort;
}): SecretsService {
  return {
    async list() {
      const secrets = await deps.port.listSecrets();

      // One-shot migration for Anthropic secrets predating explicit env picking:
      // backfill envMappings based on OneCLI's detected authMode so legacy
      // secrets keep working without a migration job.
      for (const s of secrets) {
        if (
          s.type !== "anthropic" ||
          s.metadata?.envMappings ||
          backfilled.has(s.id)
        ) {
          continue;
        }
        backfilled.add(s.id);
        const mapping =
          s.metadata?.authMode === "api-key"
            ? ANTHROPIC_API_KEY_ENV_MAPPING
            : ANTHROPIC_OAUTH_ENV_MAPPING;
        try {
          await deps.port.updateSecret(s.id, { envMappings: [mapping] });
          s.metadata = {
            ...(s.metadata ?? {}),
            envMappings: [mapping],
          };
        } catch {
          backfilled.delete(s.id);
        }
      }

      return secrets.map(toSecretView);
    },

    async create(input: CreateSecretInput) {
      // Spread keeps new optional fields (pathPattern, injectionConfig) flowing through
      // without enumerating them here; the anthropic default envMapping is filled in
      // lazily by the list() backfill above.
      const created = await deps.port.createSecret({
        ...input,
        hostPattern: hostPatternFor(input.type, input.hostPattern),
      });
      // OneCLI may not echo metadata on create; fall back to the request's envMappings.
      if (!created.metadata?.envMappings && input.envMappings) {
        created.metadata = {
          ...(created.metadata ?? {}),
          envMappings: input.envMappings,
        };
      }
      return toSecretView(created);
    },

    async update({ id, ...patch }: UpdateSecretInput) {
      await deps.port.updateSecret(id, patch);
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
