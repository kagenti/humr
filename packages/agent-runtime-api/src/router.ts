import { t } from "./trpc.js";
import { filesRouter } from "./modules/files/router.js";
import { improvementRouter } from "./modules/improvement/router.js";

export const appRouter = t.router({
  files: filesRouter,
  improvement: improvementRouter,
});

export type AppRouter = typeof appRouter;
