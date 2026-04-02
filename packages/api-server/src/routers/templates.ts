import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../trpc.js";

const k8sName = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);

const templateSpec = z.object({
  image: z.string(),
  description: z.string().optional(),
  mounts: z
    .array(z.object({ path: z.string(), persist: z.boolean() }))
    .optional(),
  init: z.string().optional(),
  env: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
  resources: z
    .object({
      requests: z.record(z.string(), z.string()).optional(),
      limits: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  securityContext: z
    .object({
      runAsNonRoot: z.boolean().optional(),
      readOnlyRootFilesystem: z.boolean().optional(),
    })
    .optional(),
});

export const templatesRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.templates.list()),

  get: t.procedure
    .input(z.object({ name: k8sName }))
    .query(async ({ ctx, input }) => {
      const tmpl = await ctx.templates.get(input.name);
      if (!tmpl) throw new TRPCError({ code: "NOT_FOUND" });
      return tmpl;
    }),

  create: t.procedure
    .input(z.object({ name: k8sName, spec: templateSpec }))
    .mutation(({ ctx, input }) => ctx.templates.create(input)),

  delete: t.procedure
    .input(z.object({ name: k8sName }))
    .mutation(({ ctx, input }) => ctx.templates.delete(input.name)),
});
