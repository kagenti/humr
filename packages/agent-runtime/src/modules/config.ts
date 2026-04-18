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
  API_SERVER_URL: z.string().default(""),
  HUMR_MCP_URL: z.string().optional(),
  ONECLI_ACCESS_TOKEN: z.string().optional(),
  /** Override the agent spawn command (e.g. "pi-acp"). When unset, spawns the
   *  default node-based ACP agent (dist/agent.js or src/agent.ts in dev). */
  AGENT_COMMAND: z.string().optional(),
});

export const config = schema.parse(process.env);
