import { z } from "zod";
import { t } from "../../trpc.js";

const sessionType = z.enum(["regular", "channel_slack"]);

export const sessionsRouter = t.router({
  list: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      includeChannel: z.boolean().optional(),
    }))
    .query(({ ctx, input }) => ctx.sessions.list(input.instanceId, input.includeChannel)),

  create: t.procedure
    .input(z.object({
      sessionId: z.string().min(1),
      instanceId: z.string().min(1),
      type: sessionType.optional(),
    }))
    .mutation(({ ctx, input }) => ctx.sessions.create(input.sessionId, input.instanceId, input.type)),
});
