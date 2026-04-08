import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { HarnessContext } from "./context.js";

const t = initTRPC.context<HarnessContext>().create();

const filesRouter = t.router({
  tree: t.procedure.query(({ ctx }) => ({
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
  files: filesRouter,
});

export type AppRouter = typeof appRouter;
