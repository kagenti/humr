import { z } from "zod";
import { t } from "../../trpc.js";
import { ENV_NAME_RE } from "./types.js";

const secretTypeSchema = z.enum(["anthropic", "generic"]);

const envMappingSchema = z.object({
  envName: z
    .string()
    .min(1)
    .max(255)
    .regex(ENV_NAME_RE, "envName must match [A-Z_][A-Z0-9_]*"),
  placeholder: z.string().min(1).max(1000),
});

const envMappingsSchema = z.array(envMappingSchema).max(32);

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
          envMappings: envMappingsSchema.optional(),
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
        envMappings: envMappingsSchema.optional(),
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
