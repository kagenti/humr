import { t } from "./trpc.js";
import { channelsRouter } from "./modules/channels/router.js";
import { instancesRouter } from "./modules/instances/router.js";
import { schedulesRouter } from "./modules/schedules/router.js";
import { templatesRouter } from "./modules/templates/router.js";

export const appRouter = t.router({
  templates: templatesRouter,
  instances: instancesRouter,
  schedules: schedulesRouter,
  channels: channelsRouter,
});

export type AppRouter = typeof appRouter;
