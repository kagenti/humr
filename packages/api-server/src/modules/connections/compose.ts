import {
  createForeignRegistrationService,
  type ForeignRegistrationService,
} from "./services/foreign-registration-service.js";
import {
  createOnecliForeignCredentialsPort,
  type OnecliForeignCredentialsConfig,
} from "./infrastructure/onecli-foreign-credentials-port.js";

export function composeConnectionsModule(deps: {
  foreignCredentialsConfig: OnecliForeignCredentialsConfig;
}): { foreignCredentials: ForeignRegistrationService } {
  return {
    foreignCredentials: createForeignRegistrationService({
      port: createOnecliForeignCredentialsPort(deps.foreignCredentialsConfig),
    }),
  };
}
