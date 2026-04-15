import { z } from "zod";
import { t } from "../../trpc.js";

const secretTypeSchema = z.enum(["anthropic", "generic"]);

export const secretsRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.secrets.list()),

  create: t.procedure
    .input(
      z
        .object({
          type: secretTypeSchema,
          name: z.string().min(1).max(100),
          value: z.string().min(1),
          hostPattern: z.string().min(1).max(253).optional(),
        })
        .refine(
          (d) => d.type === "anthropic" || !!d.hostPattern,
          { message: "hostPattern is required for generic secrets", path: ["hostPattern"] },
        )
        .refine(
          (d) => d.type !== "anthropic" || !d.hostPattern,
          { message: "hostPattern cannot be set for anthropic secrets", path: ["hostPattern"] },
        ),
    )
    .mutation(({ ctx, input }) => ctx.secrets.create(input)),

  update: t.procedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        value: z.string().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.secrets.update(input)),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.secrets.delete(input.id)),

  getAgentAccess: t.procedure
    .input(z.object({ agentName: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.secrets.getAgentAccess(input.agentName)),

  setAgentAccess: t.procedure
    .input(
      z.object({
        agentName: z.string().min(1),
        mode: z.enum(["all", "selective"]),
        secretIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.secrets.setAgentAccess(input.agentName, {
        mode: input.mode,
        secretIds: input.secretIds,
      }),
    ),
});
