import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { HarnessContext } from "./context.js";

const t = initTRPC.context<HarnessContext>().create();

const configRouter = t.router({
  get: t.procedure.query(({ ctx }) => ({
    cwd: ctx.workingDir,
  })),
});

const authRouter = t.router({
  status: t.procedure.query(({ ctx }) => ctx.claudeCodeAuth.getAuthStatus()),

  login: t.procedure.mutation(({ ctx }) => ctx.claudeCodeAuth.startLogin()),

  code: t.procedure
    .input(z.object({ code: z.string() }))
    .mutation(({ ctx, input }) => ctx.claudeCodeAuth.submitAuthCode(input.code)),
});

const filesRouter = t.router({
  version: t.procedure.query(({ ctx }) => ({
    version: ctx.files.fileVersion(),
  })),

  tree: t.procedure.query(({ ctx }) => ({
    version: ctx.files.fileVersion(),
    entries: ctx.files.buildTree(),
  })),

  read: t.procedure
    .input(z.object({ path: z.string() }))
    .query(({ ctx, input }) => {
      const result = ctx.files.readFileSafe(input.path);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return result;
    }),
});

export const appRouter = t.router({
  config: configRouter,
  auth: authRouter,
  files: filesRouter,
});

export type AppRouter = typeof appRouter;
