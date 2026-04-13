import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { Agent } from "./types.js";

function toView(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    templateId: agent.templateId ?? null,
    image: agent.spec.image,
    description: agent.spec.description,
    mcpServers: agent.spec.mcpServers ?? null,
  };
}

const mcpServerSchema = z.object({
  type: z.enum(["stdio", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
});

export const agentsRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const agents = await ctx.agents.list();
    return agents.map(toView);
  }),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const agent = await ctx.agents.get(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  create: t.procedure
    .input(z.object({
      name: z.string().min(1),
      templateId: z.string().optional(),
      image: z.string().optional(),
      description: z.string().optional(),
      mcpServers: z.record(z.string(), mcpServerSchema).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.templateId && !input.image) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Either templateId or image is required" });
      }
      const agent = await ctx.agents.create(input);
      return toView(agent);
    }),

  update: t.procedure
    .input(z.object({
      id: z.string().min(1),
      description: z.string().optional(),
      mcpServers: z.record(z.string(), mcpServerSchema).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.update(input);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.agents.delete(input.id)),
});
