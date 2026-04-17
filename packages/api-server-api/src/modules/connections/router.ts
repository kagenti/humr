import { z } from "zod";
import { t } from "../../trpc.js";

export const connectionsRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.connections.list()),

  getAgentConnections: t.procedure
    .input(z.object({ agentName: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.connections.getAgentConnections(input.agentName)),

  setAgentConnections: t.procedure
    .input(
      z.object({
        agentName: z.string().min(1),
        connectionIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.connections.setAgentConnections(input.agentName, input.connectionIds),
    ),
});
