import { z } from "zod";
import { t } from "../../trpc.js";

export const approvalsRouter = t.router({
  listForOwner: t.procedure
    .query(({ ctx }) => ctx.approvals.listForOwner()),

  listForInstance: t.procedure
    .input(z.object({ instanceId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.approvals.listForInstance(input.instanceId)),

  approveOnce: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.approveOnce(input.id)),

  approvePermanent: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.approvePermanent(input.id)),

  approveHost: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.approveHost(input.id)),

  denyForever: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.denyForever(input.id)),
});
