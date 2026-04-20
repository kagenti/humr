export type { AppRouter } from "./router.js";
export type { ApiContext, UserIdentity } from "./context.js";

export { ChannelType, type EnvVar } from "./modules/shared.js";

export { SPEC_VERSION } from "./modules/templates/types.js";
export type {
  Template,
  TemplateSpec,
  TemplatesService,
  Mount,
  Resources,
  SecurityContext,
} from "./modules/templates/types.js";

export type {
  Agent,
  AgentSpec,
  AgentsService,
  CreateAgentInput,
  UpdateAgentInput,
} from "./modules/agents/types.js";
export {
  PROTECTED_AGENT_ENV_NAMES,
  isProtectedAgentEnvName,
} from "./modules/agents/types.js";

export type {
  Instance,
  InstanceState,
  Channel,
  SlackChannel,
  ChannelConfig,
  CreateInstanceInput,
  UpdateInstanceInput,
  InstancesService,
} from "./modules/instances/types.js";

export type {
  Schedule,
  ScheduleSpec,
  ScheduleStatus,
  CreateCronScheduleInput,
  SchedulesService,
} from "./modules/schedules/types.js";

export type {
  SecretType,
  SecretMode,
  AnthropicAuthMode,
  SecretView,
  CreateSecretInput,
  UpdateSecretInput,
  AgentAccess,
  SecretsService,
  EnvMapping,
  InjectionConfig,
} from "./modules/secrets/types.js";
export {
  DEFAULT_ENV_PLACEHOLDER,
  DEFAULT_INJECTION_CONFIG,
  ENV_NAME_RE,
  isValidEnvName,
  ANTHROPIC_DEFAULT_ENV_MAPPING,
} from "./modules/secrets/types.js";

export type { ChannelsService } from "./modules/channels/types.js";

export type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "./modules/connections/types.js";

export { SessionType } from "./modules/sessions/types.js";
export type {
  SessionView,
  SessionsService as SessionsApiService,
} from "./modules/sessions/types.js";
