import type { ChannelsService } from "./modules/channels/types.js";
import type { InstancesService } from "./modules/instances/types.js";
import type { SchedulesService } from "./modules/schedules/types.js";
import type { TemplatesService } from "./modules/templates/types.js";

export interface ApiContext {
  templates: TemplatesService;
  instances: InstancesService;
  schedules: SchedulesService;
  channels: ChannelsService;
}
