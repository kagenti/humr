import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { Schedule } from "./types.js";

const k8sName = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);

function toView(sched: Schedule) {
  return {
    name: sched.name,
    instanceName: sched.instanceName,
    type: sched.spec.type,
    cron: sched.spec.cron,
    task: sched.spec.task ?? null,
    enabled: sched.spec.enabled,
    status: sched.status ?? null,
  };
}

export const schedulesRouter = t.router({
  list: t.procedure
    .input(z.object({ instanceName: k8sName }))
    .query(async ({ ctx, input }) => {
      const schedules = await ctx.schedules.list(input.instanceName);
      return schedules.map(toView);
    }),

  get: t.procedure
    .input(z.object({ name: k8sName }))
    .query(async ({ ctx, input }) => {
      const sched = await ctx.schedules.get(input.name);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  createCron: t.procedure
    .input(z.object({
      name: k8sName,
      instanceName: k8sName,
      cron: z.string().min(1),
      task: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createCron(input);
      return toView(sched);
    }),

  createHeartbeat: t.procedure
    .input(z.object({
      name: k8sName,
      instanceName: k8sName,
      intervalMinutes: z.number().int().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createHeartbeat(input);
      return toView(sched);
    }),

  delete: t.procedure
    .input(z.object({ name: k8sName }))
    .mutation(({ ctx, input }) => ctx.schedules.delete(input.name)),

  toggle: t.procedure
    .input(z.object({ name: k8sName }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.toggle(input.name);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  config: t.procedure.query(({ ctx }) => ctx.schedules.config()),
});
