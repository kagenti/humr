import type { FilesService } from "./modules/files/types.js";
import type { ImprovementService } from "./modules/improvement/types.js";

export interface AgentRuntimeContext {
  files: FilesService;
  improvement: ImprovementService;
}
