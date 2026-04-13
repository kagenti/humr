import type { ChannelsContext } from "./modules/channels/services/port.js";
import type { InstancesContext } from "./modules/instances/services/port.js";
import type { SchedulesContext } from "./modules/schedules/services/port.js";
import type { TemplatesContext } from "./modules/templates/services/port.js";

export interface ApiContext {
  templates: TemplatesContext;
  instances: InstancesContext;
  schedules: SchedulesContext;
  channels: ChannelsContext;
}
