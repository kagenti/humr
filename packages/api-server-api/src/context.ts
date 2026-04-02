import type { InstancesContext } from "./modules/instances.js";
import type { TemplatesContext } from "./modules/templates.js";

export interface ApiContext {
  templates: TemplatesContext;
  instances: InstancesContext;
}
