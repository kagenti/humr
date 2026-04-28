import { z } from "zod";

/**
 * Set fields are stored as sorted arrays so React Hook Form's structural
 * equality check (used for `isDirty` / `dirtyFields`) matches on content.
 * `dirtyFields.selSecrets` replaces the manual `secretsDirty` flag the
 * pre-RHF version carried for the "user-touched-secrets" semantics.
 */
export const addAgentSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  description: z.string().trim(),
  selSecrets: z.array(z.string()),
  selApps: z.array(z.string()),
  experimentalCredentialInjector: z.boolean(),
});

export type AddAgentValues = z.infer<typeof addAgentSchema>;
