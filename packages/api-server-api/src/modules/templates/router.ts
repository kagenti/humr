import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { Template } from "./types.js";

const k8sName = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);

function toView(tmpl: Template) {
  return {
    name: tmpl.name,
    image: tmpl.spec.image,
    description: tmpl.spec.description,
    mcpServers: tmpl.spec.mcpServers ?? null,
  };
}

export const templatesRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const templates = await ctx.templates.list();
    return templates.map(toView);
  }),

  get: t.procedure
    .input(z.object({ name: k8sName }))
    .query(async ({ ctx, input }) => {
      const tmpl = await ctx.templates.get(input.name);
      if (!tmpl) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(tmpl);
    }),

  create: t.procedure
    .input(z.object({
      name: k8sName,
      image: z.string(),
      description: z.string().optional(),
      mcpServers: z.record(z.string(), z.object({
        type: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tmpl = await ctx.templates.create(input);
      return toView(tmpl);
    }),

  delete: t.procedure
    .input(z.object({ name: k8sName }))
    .mutation(({ ctx, input }) => ctx.templates.delete(input.name)),
});
