import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  HUMR_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  HOME_DIR: z.string().default("/home/agent"),
  WORK_DIR: z.string().default("/home/agent/work"),
  TRIGGERS_DIR: z.string().default("/home/agent/.triggers"),
});

export const config = schema.parse(process.env);
