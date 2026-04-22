import { createForksService, type ForksService } from "./services/forks-service.js";
import type {
  ForeignCredentialsPort,
  ForkOrchestratorPort,
} from "./infrastructure/ports.js";

export function composeForksModule(deps: {
  foreignCredentials: ForeignCredentialsPort;
  orchestrator: ForkOrchestratorPort;
}): { forks: ForksService } {
  return { forks: createForksService(deps) };
}
