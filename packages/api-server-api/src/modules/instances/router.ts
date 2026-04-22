import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";

const envVarSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const instancesRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.instances.list()),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const inst = await ctx.instances.get(input.id);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return inst;
    }),

  create: t.procedure
    .input(z.object({
      name: z.string().min(1),
      agentId: z.string().min(1),
      env: z.array(envVarSchema).optional(),
      secretRef: z.string().optional(),
      description: z.string().optional(),
      allowedUserEmails: z.array(z.email()).optional(),
    }))
    .mutation(async ({ ctx, input }) => ctx.instances.create(input)),

  update: t.procedure
    .input(z.object({
      id: z.string().min(1),
      env: z.array(envVarSchema).optional(),
      secretRef: z.string().optional(),
      allowedUserEmails: z.array(z.email()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.update(input);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return inst;
    }),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.instances.delete(input.id)),

  wake: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.wake(input.id);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return inst;
    }),

  connectSlack: t.procedure
    .input(z.object({
      id: z.string().min(1),
      slackChannelId: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.slack) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Slack app token not configured" });
      const inst = await ctx.instances.connectSlack(input.id, input.slackChannelId);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return inst;
    }),

  disconnectSlack: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.disconnectSlack(input.id);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return inst;
    }),
});
