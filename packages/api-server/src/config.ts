import { z } from "zod/v4";

const configSchema = z.object({
  namespace: z.string().default("humr-agents"),
  port: z.coerce.number().default(4000),
  slackAppToken: z.string().nullable().default(null),
  uiBaseUrl: z.url().default("http://humr.localhost:4444"),
  onecliBaseUrl: z.url().default("http://humr-onecli:10254"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    namespace: process.env.NAMESPACE,
    port: process.env.PORT,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    uiBaseUrl: process.env.UI_BASE_URL,
    onecliBaseUrl: process.env.ONECLI_WEB_URL,
  });
}
