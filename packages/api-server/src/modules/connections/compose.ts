import {
  createForeignRegistrationService,
  type ForeignRegistrationService,
} from "./services/foreign-registration-service.js";
import { createOnecliForeignCredentialsPort } from "./infrastructure/onecli-foreign-credentials-port.js";
import type { OnecliClient } from "../../apps/api-server/onecli.js";

export function composeConnectionsModule(deps: {
  onecli: OnecliClient;
}): { foreignCredentials: ForeignRegistrationService } {
  return {
    foreignCredentials: createForeignRegistrationService({
      port: createOnecliForeignCredentialsPort(deps.onecli),
    }),
  };
}
