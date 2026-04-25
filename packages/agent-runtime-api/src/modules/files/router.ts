import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";

const pathSchema = z.string().min(1);

export const filesRouter = t.router({
  tree: t.procedure.query(({ ctx }) => ({
    entries: ctx.files.buildTree(),
  })),

  read: t.procedure
    .input(z.object({ path: pathSchema }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.files.readFileSafe(input.path);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return result;
    }),

  write: t.procedure
    .input(z.object({
      path: pathSchema,
      content: z.string(),
      expectedMtimeMs: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.files.writeFileSafe(
          input.path,
          input.content,
          input.expectedMtimeMs,
        );
        if ("conflict" in result) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "file changed on disk",
            cause: { currentMtimeMs: result.currentMtimeMs },
          });
        }
        return { mtimeMs: result.mtimeMs };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "FORBIDDEN", message: (err as Error).message });
      }
    }),

  create: t.procedure
    .input(z.object({ path: pathSchema, content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.files.createFileSafe(input.path, input.content);
        if ("exists" in result) {
          throw new TRPCError({ code: "CONFLICT", message: "path already exists" });
        }
        return { mtimeMs: result.mtimeMs };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "FORBIDDEN", message: (err as Error).message });
      }
    }),

  mkdir: t.procedure
    .input(z.object({ path: pathSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.files.mkdirSafe(input.path);
        if ("exists" in result) {
          throw new TRPCError({ code: "CONFLICT", message: "path exists and is not a directory" });
        }
        return { ok: true as const };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "FORBIDDEN", message: (err as Error).message });
      }
    }),

  rename: t.procedure
    .input(z.object({
      from: pathSchema,
      to: pathSchema,
      overwrite: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.files.renameSafe(input.from, input.to, input.overwrite ?? false);
        if ("exists" in result) {
          throw new TRPCError({ code: "CONFLICT", message: "destination already exists" });
        }
        return { ok: true as const };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "FORBIDDEN", message: (err as Error).message });
      }
    }),

  remove: t.procedure
    .input(z.object({ path: pathSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.files.deleteSafe(input.path);
        return { ok: true as const };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "FORBIDDEN", message: (err as Error).message });
      }
    }),

  upload: t.procedure
    .input(z.object({
      path: pathSchema,
      contentBase64: z.string(),
      /** Browser-reported MIME (File.type). Carried in the API for observability
       *  and forward-compat; server-side reads still detect MIME from magic
       *  bytes so we don't need to persist this. */
      contentType: z.string().max(255).optional(),
      overwrite: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await ctx.files.uploadFileSafe(
          input.path,
          input.contentBase64,
          input.overwrite ?? false,
        );
        if ("exists" in result) {
          throw new TRPCError({ code: "CONFLICT", message: "path already exists" });
        }
        return {
          mtimeMs: result.mtimeMs,
          absolutePath: result.absolutePath,
          contentType: input.contentType,
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const msg = (err as Error).message;
        throw new TRPCError({
          code: /too large/i.test(msg) ? "PAYLOAD_TOO_LARGE" : "FORBIDDEN",
          message: msg,
        });
      }
    }),
});
