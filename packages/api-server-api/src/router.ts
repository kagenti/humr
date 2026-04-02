import { t } from "./trpc.js";
import { instancesRouter } from "./routers/instances.js";
import { templatesRouter } from "./routers/templates.js";

export const appRouter = t.router({
  templates: templatesRouter,
  instances: instancesRouter,
});

export type AppRouter = typeof appRouter;
