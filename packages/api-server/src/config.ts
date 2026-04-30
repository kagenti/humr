import { z } from "zod/v4";

const configSchema = z.object({
  namespace: z.string().default("humr-agents"),
  port: z.coerce.number().default(4000),
  harnessServerPort: z.coerce.number().default(4001),
  /** gRPC ext_authz listener — serves both Envoy's HTTP filter (L7,
   *  TLS-terminated chains) and network filter (L4, catch-all). */
  extAuthzPort: z.coerce.number().default(4002),
  databaseUrl: z.string(),
  migrationsPath: z.string().default("./packages/db/drizzle"),
  slackBotToken: z.string().nullable().default(null),
  slackAppToken: z.string().nullable().default(null),
  slackOauthCallbackUrl: z.string().nullable().default(null),
  telegramEnabled: z.coerce.boolean().default(false),
  uiBaseUrl: z.url().default("http://humr.localhost:4444"),
  onecliBaseUrl: z.url().default("http://humr-onecli:10254"),
  onecliExternalUrl: z.string().default(""),
  onecliAudience: z.string().default("onecli"),
  keycloakUrl: z.url().default("http://humr-keycloak:8080"),
  keycloakExternalUrl: z.url().default("http://keycloak.localhost:4444"),
  keycloakRealm: z.string().default("humr"),
  keycloakClientId: z.string().default("humr-ui"),
  keycloakApiAudience: z.string().default("humr-api"),
  keycloakApiClientId: z.string().default("humr-api"),
  keycloakApiClientSecret: z.string().default(""),
  keycloakRequiredRole: z.string().optional(),
  agentHome: z.string().default("/home/agent"),
  redisUrl: z.string().nullable().default(null),
  /** Default hold window for ext_authz HITL (seconds). Helm-configurable;
   *  matches `pending_approvals.expires_at` and the synchronous-hold deadline. */
  approvalHoldSeconds: z.coerce.number().int().positive().default(1800),
  /** Path to a newline-delimited file of hosts seeded by the `trusted` egress
   *  preset (DRAFT-unified-hitl-ux). Mounted from a Helm-managed ConfigMap.
   *  Empty/missing file → preset is empty (still selectable, just seeds nothing). */
  trustedHostsPath: z.string().default(""),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    namespace: process.env.NAMESPACE,
    port: process.env.PORT,
    harnessServerPort: process.env.MCP_PORT,
    extAuthzPort: process.env.EXT_AUTHZ_PORT,
    databaseUrl: process.env.DATABASE_URL,
    migrationsPath: process.env.MIGRATIONS_PATH,
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackOauthCallbackUrl: process.env.SLACK_OAUTH_CALLBACK_URL,
    telegramEnabled: process.env.TELEGRAM_ENABLED,
    uiBaseUrl: process.env.UI_BASE_URL,
    onecliBaseUrl: process.env.ONECLI_WEB_URL,
    onecliExternalUrl: process.env.ONECLI_EXTERNAL_URL,
    onecliAudience: process.env.ONECLI_AUDIENCE,
    keycloakUrl: process.env.KEYCLOAK_URL,
    keycloakExternalUrl: process.env.KEYCLOAK_EXTERNAL_URL,
    keycloakRealm: process.env.KEYCLOAK_REALM,
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID,
    keycloakApiAudience: process.env.KEYCLOAK_API_AUDIENCE,
    keycloakApiClientId: process.env.KEYCLOAK_API_CLIENT_ID,
    keycloakApiClientSecret: process.env.KEYCLOAK_API_CLIENT_SECRET,
    keycloakRequiredRole: process.env.KEYCLOAK_REQUIRED_ROLE,
    agentHome: process.env.AGENT_HOME,
    redisUrl: process.env.REDIS_URL,
    approvalHoldSeconds: process.env.APPROVAL_HOLD_SECONDS,
    trustedHostsPath: process.env.TRUSTED_HOSTS_PATH,
  });
}
