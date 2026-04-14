export { appRouter, type AppRouter } from "./router.js";
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
  MCPServerConfig,
} from "./modules/templates/types.js";

export type {
  Agent,
  AgentSpec,
  AgentsService,
  CreateAgentInput,
  UpdateAgentInput,
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
  ScheduleConfig,
  CreateCronScheduleInput,
  CreateHeartbeatScheduleInput,
  CreateImprovementScheduleInput,
  ImprovementState,
  ImprovementRuntimeState,
  ImprovementSkippedInfo,
  SchedulesService,
} from "./modules/schedules/types.js";

export type { ChannelsService } from "./modules/channels/types.js";
