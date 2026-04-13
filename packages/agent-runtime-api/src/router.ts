import { t } from "./trpc.js";
import { filesRouter } from "./modules/files/routers/files.js";

export const appRouter = t.router({
  files: filesRouter,
});

export type AppRouter = typeof appRouter;
