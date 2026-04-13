export { appRouter, type AppRouter } from "./router.js";
export type { ApiContext } from "./context.js";

export { type Result, ok, err } from "./shared/domain/result.js";
export type { DomainEvent } from "./shared/domain/event.js";
export { ChannelType, type EnvVar } from "./shared/domain/types.js";

export { SPEC_VERSION } from "./modules/templates/domain/types.js";
export type {
  Template,
  TemplateSpec,
  CreateTemplateInput,
} from "./modules/templates/domain/types.js";
export type { TemplatesContext } from "./modules/templates/services/port.js";

export type {
  Instance,
  InstanceSpec,
  InstanceStatus,
  Channel,
  SlackChannel,
  ChannelConfig,
  CreateInstanceInput,
  UpdateInstanceInput,
} from "./modules/instances/domain/types.js";
export type { InstancesContext } from "./modules/instances/services/port.js";

export type {
  Schedule,
  ScheduleSpec,
  ScheduleStatus,
  ScheduleConfig,
  CreateCronScheduleInput,
  CreateHeartbeatScheduleInput,
} from "./modules/schedules/domain/types.js";
export type { SchedulesContext } from "./modules/schedules/services/port.js";

export type { ChannelsContext } from "./modules/channels/services/port.js";
