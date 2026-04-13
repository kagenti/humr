import { t } from "./trpc.js";
import { channelsRouter } from "./modules/channels/routers/channels.js";
import { instancesRouter } from "./modules/instances/routers/instances.js";
import { schedulesRouter } from "./modules/schedules/routers/schedules.js";
import { templatesRouter } from "./modules/templates/routers/templates.js";

export const appRouter = t.router({
  templates: templatesRouter,
  instances: instancesRouter,
  schedules: schedulesRouter,
  channels: channelsRouter,
});

export type AppRouter = typeof appRouter;
