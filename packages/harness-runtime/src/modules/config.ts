import { z } from "zod/v4";
import { homedir } from "node:os";
import { join } from "node:path";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  HUMR_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  CLAUDE_CONFIG_DIR: z.string().default(join(homedir(), ".claude")),
});

export const config = schema.parse(process.env);
