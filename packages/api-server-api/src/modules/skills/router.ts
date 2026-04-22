import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";

const skillSourceViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  gitUrl: z.string(),
  system: z.boolean().optional(),
  canPublish: z.boolean().optional(),
});

const publishResultSchema = z.object({
  prUrl: z.string().url(),
  branch: z.string(),
});

const skillViewSchema = z.object({
  source: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
});

const skillRefSchema = z.object({
  source: z.string(),
  name: z.string(),
  version: z.string(),
});

const localSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillPath: z.string(),
});

export const skillsRouter = t.router({
  sources: t.router({
    list: t.procedure.output(z.array(skillSourceViewSchema)).query(({ ctx }) => ctx.skills.listSources()),

    create: t.procedure
      .input(z.object({
        name: z.string().min(1).max(128),
        gitUrl: z.string().url(),
      }))
      .output(skillSourceViewSchema)
      .mutation(({ ctx, input }) => ctx.skills.createSource(input)),

    delete: t.procedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.skills.deleteSource(input.id)),

    /** Drop the scan cache for this source so the next listSkills re-queries
     *  upstream. Called after merging a PR, pushing out-of-band, etc. */
    refresh: t.procedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.skills.refreshSource(input.id)),
  }),

  listSkills: t.procedure
    .input(z.object({ sourceId: z.string().min(1) }))
    .output(z.array(skillViewSchema))
    .query(async ({ ctx, input }) => {
      const src = await ctx.skills.getSource(input.sourceId);
      if (!src) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.skills.listSkills(input.sourceId);
    }),

  install: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      source: z.string().url(),
      name: z.string().min(1),
      version: z.string().min(1),
    }))
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.installSkill(input)),

  uninstall: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      source: z.string().url(),
      name: z.string().min(1),
    }))
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.uninstallSkill(input)),

  listLocal: t.procedure
    .input(z.object({ instanceId: z.string().min(1) }))
    .output(z.array(localSkillSchema))
    .query(({ ctx, input }) => ctx.skills.listLocal(input.instanceId)),

  publish: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      sourceId: z.string().min(1),
      name: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    }))
    .output(publishResultSchema)
    .mutation(({ ctx, input }) => ctx.skills.publishSkill(input)),
});
