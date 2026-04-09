import type { InstancesContext } from "./modules/instances.js";
import type { SchedulesContext } from "./modules/schedules.js";
import type { TemplatesContext } from "./modules/templates.js";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
}

export interface ApiContext {
  templates: TemplatesContext;
  instances: InstancesContext;
  schedules: SchedulesContext;
  user: UserIdentity;
}
