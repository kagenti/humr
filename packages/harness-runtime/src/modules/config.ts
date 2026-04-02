import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  HUMR_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

export const config = schema.parse(process.env);
