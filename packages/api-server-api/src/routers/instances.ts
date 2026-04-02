import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../trpc.js";
import type { Instance } from "../modules/instances.js";

const k8sName = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);

const envVarSchema = z.object({
  name: z.string(),
  value: z.string(),
});

function toView(inst: Instance) {
  return {
    name: inst.name,
    templateName: inst.spec.templateName,
    description: inst.spec.description,
    env: inst.spec.env,
    secretRef: inst.spec.secretRef,
    desiredState: inst.spec.desiredState,
  };
}

export const instancesRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const instances = await ctx.instances.list();
    return instances.map(toView);
  }),

  get: t.procedure
    .input(z.object({ name: k8sName }))
    .query(async ({ ctx, input }) => {
      const inst = await ctx.instances.get(input.name);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(inst);
    }),

  create: t.procedure
    .input(z.object({
      name: k8sName,
      templateName: k8sName,
      env: z.array(envVarSchema).optional(),
      secretRef: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.create(input);
      return toView(inst);
    }),

  update: t.procedure
    .input(z.object({
      name: k8sName,
      env: z.array(envVarSchema).optional(),
      secretRef: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await ctx.instances.update(input);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(inst);
    }),

  delete: t.procedure
    .input(z.object({ name: k8sName }))
    .mutation(({ ctx, input }) => ctx.instances.delete(input.name)),
});
