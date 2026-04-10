import { t } from "./trpc.js";
import { agentsRouter } from "./routers/agents.js";
import { instancesRouter } from "./routers/instances.js";
import { schedulesRouter } from "./routers/schedules.js";
import { templatesRouter } from "./routers/templates.js";

export const appRouter = t.router({
  templates: templatesRouter,
  agents: agentsRouter,
  instances: instancesRouter,
  schedules: schedulesRouter,
});

export type AppRouter = typeof appRouter;
