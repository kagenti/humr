import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";

export const filesRouter = t.router({
  tree: t.procedure.query(({ ctx }) => ({
    entries: ctx.files.buildTree(),
  })),

  read: t.procedure
    .input(z.object({ path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.files.readFileSafe(input.path);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return result;
    }),
});
