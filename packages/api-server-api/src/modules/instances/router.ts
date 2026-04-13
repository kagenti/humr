import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { Instance } from "./types.js";

const envVarSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const enabledMcpServersSchema = z.array(z.string()).optional();

function toView(inst: Instance) {
  return {
    id: inst.id,
    name: inst.name,
    agentId: inst.spec.agentId,
    description: inst.spec.description,
    env: inst.spec.env,
    secretRef: inst.spec.secretRef,
    desiredState: inst.spec.desiredState,
    enabledMcpServers: inst.spec.enabledMcpServers ?? null,
    connectedChannels: (inst.spec.channels ?? []).map(c => c.type),
    status: inst.status ?? null,
  };
}

export const instancesRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const instances = await ctx.instances.list();
    return instances.map(toView);
  }),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const inst = await ctx.instances.get(input.id);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(inst);
    }),

  create: t.procedure
    .input(z.object({
      name: z.string().min(1),
      agentId: z.string().min(1),
      env: z.array(envVarSchema).optional(),
      secretRef: z.string().optional(),
      description: z.string().optional(),
      enabledMcpServers: enabledMcpServersSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.create(input);
      return toView(inst);
    }),

  update: t.procedure
    .input(z.object({
      id: z.string().min(1),
      env: z.array(envVarSchema).optional(),
      secretRef: z.string().optional(),
      enabledMcpServers: enabledMcpServersSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.update(input);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(inst);
    }),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.instances.delete(input.id)),

  wake: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.wake(input.id);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(inst);
    }),

  connectSlack: t.procedure
    .input(z.object({
      id: z.string().min(1),
      botToken: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.slack) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Slack app token not configured" });
      const inst = await ctx.instances.connectSlack(input.id, input.botToken);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(inst);
    }),

  disconnectSlack: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.disconnectSlack(input.id);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(inst);
    }),
});
