import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { Schedule, ImprovementState, SchedulesService } from "./types.js";

function toView(sched: Schedule, improvementState: ImprovementState | null = null) {
  return {
    id: sched.id,
    name: sched.name,
    instanceId: sched.instanceId,
    type: sched.spec.type,
    cron: sched.spec.cron,
    task: sched.spec.task ?? null,
    enabled: sched.spec.enabled,
    status: sched.status ?? null,
    improvementState,
  };
}

/** Fetch improvement state for a schedule if it's improvement-type, else null. */
async function withImprovementState(
  schedules: SchedulesService,
  sched: Schedule,
): Promise<ImprovementState | null> {
  if (sched.spec.type !== "improvement") return null;
  return schedules.getImprovementState(sched.instanceId);
}

export const schedulesRouter = t.router({
  list: t.procedure
    .input(z.object({ instanceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const schedules = await ctx.schedules.list(input.instanceId);
      // Fetch improvement state once (shared across all improvement schedules
      // of the same instance since the workspace is per-instance).
      // Returns `idle` on any error so this never blocks the list.
      const hasImprovement = schedules.some((s) => s.spec.type === "improvement");
      const sharedState = hasImprovement
        ? await ctx.schedules.getImprovementState(input.instanceId).catch(() => null)
        : null;
      return schedules.map((s) =>
        toView(s, s.spec.type === "improvement" ? sharedState : null),
      );
    }),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const sched = await ctx.schedules.get(input.id);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      const improvementState = await withImprovementState(ctx.schedules, sched);
      return toView(sched, improvementState);
    }),

  createCron: t.procedure
    .input(z.object({
      name: z.string().min(1),
      instanceId: z.string().min(1),
      cron: z.string().min(1),
      task: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createCron(input);
      return toView(sched);
    }),

  createHeartbeat: t.procedure
    .input(z.object({
      name: z.string().min(1),
      instanceId: z.string().min(1),
      intervalMinutes: z.number().int().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createHeartbeat(input);
      return toView(sched);
    }),

  createImprovement: t.procedure
    .input(z.object({
      name: z.string().min(1),
      instanceId: z.string().min(1),
      cron: z.string().min(1),
      task: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createImprovement(input);
      return toView(sched);
    }),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.schedules.delete(input.id)),

  toggle: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.toggle(input.id);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      const improvementState = await withImprovementState(ctx.schedules, sched);
      return toView(sched, improvementState);
    }),

  config: t.procedure.query(({ ctx }) => ctx.schedules.config()),
});
