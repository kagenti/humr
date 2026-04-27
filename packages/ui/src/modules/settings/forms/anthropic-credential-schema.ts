import { z } from "zod";

import { type Mode, MODES, stripWhitespace } from "../components/anthropic/modes.js";

/**
 * The credential field reads as raw user input but validates against the
 * whitespace-stripped value (the `claude setup-token` output gets newlines
 * inserted on copy). The cross-field refinement surfaces "wrong tab" mismatches
 * inline, matching the prior bespoke `mismatchError` helper.
 */
export const anthropicCredentialSchema = z
  .object({
    mode: z.enum(["oauth", "api-key"] as const satisfies readonly Mode[]),
    value: z.string(),
  })
  .superRefine((data, ctx) => {
    const v = stripWhitespace(data.value);
    if (v.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Required",
      });
      return;
    }
    for (const m of Object.keys(MODES) as Mode[]) {
      if (m !== data.mode && v.startsWith(MODES[m].prefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: `This looks like ${MODES[m].label.toLowerCase()} — switch tabs.`,
        });
      }
    }
  });

export type AnthropicCredentialValues = z.infer<typeof anthropicCredentialSchema>;
