import { z } from "zod/v4";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  HUMR_DEV: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  AGENT_COMMAND: z.string().min(1).default("claude-code-acp"),
  HOME_DIR: z.string().default("/home/agent"),
  WORK_DIR: z.string().default("/home/agent/work"),
  TRIGGERS_DIR: z.string().default("/home/agent/.triggers"),
  API_SERVER_URL: z.string().default(""),
  HUMR_MCP_URL: z.string().optional(),
  ONECLI_ACCESS_TOKEN: z.string().optional(),
});

export const config = schema.parse(process.env);
