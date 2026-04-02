import { t } from "./trpc.js";
import { templatesRouter } from "./routers/templates.js";

export const appRouter = t.router({
  templates: templatesRouter,
});

export type AppRouter = typeof appRouter;
