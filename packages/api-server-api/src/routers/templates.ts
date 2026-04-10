import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../trpc.js";
import type { Template } from "../modules/templates.js";

function toView(tmpl: Template) {
  return {
    id: tmpl.id,
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
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tmpl = await ctx.templates.get(input.id);
      if (!tmpl) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(tmpl);
    }),

  create: t.procedure
    .input(z.object({
      name: z.string().min(1),
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
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.templates.delete(input.id)),
});
