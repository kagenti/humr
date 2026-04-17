import { createDb, runMigrations } from "db";
import { createApi } from "./modules/agents/infrastructure/k8s.js";
import { composeSystemInstances, startK8sCleanupSaga, startChannelCleanupSaga } from "./modules/agents/index.js";
import { createK8sClient } from "./modules/agents/infrastructure/k8s.js";
import {
  deleteChannelsByInstance, listChannelsByInstance,
} from "./modules/agents/infrastructure/channels-repository.js";
import { upsertSession } from "./modules/agents/infrastructure/sessions-repository.js";
import { createSlackWorker, type SlackOAuthPending } from "./modules/channels/infrastructure/slack.js";
import { createTelegramWorker } from "./modules/channels/infrastructure/telegram.js";
import { createUnifiedWorker } from "./modules/channels/infrastructure/unified-worker.js";
import { createChannelManager } from "./modules/channels/services/channel-manager.js";
import { createIdentityLinkService } from "./modules/channels/services/identity-link-service.js";
import {
  findIdentityLink, upsertIdentityLink, deleteIdentityLink,
} from "./modules/channels/infrastructure/identity-links-repository.js";
import type { PendingOAuthFlow } from "./auth/identity-oauth.js";
import { loadConfig } from "./config.js";
import { createOnecliClient } from "./onecli.js";
import { startOnecliSyncSaga } from "./sagas/onecli-sync.js";
import { startApiServerApp } from "./apps/api-server/app.js";
import { startHarnessApiServerApp } from "./apps/harness-api-server/app.js";

const config = loadConfig();

const onecli = createOnecliClient({
  keycloakTokenUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
  clientId: config.keycloakApiClientId,
  clientSecret: config.keycloakApiClientSecret,
  onecliAudience: config.onecliAudience,
  onecliBaseUrl: config.onecliBaseUrl,
});

const { api } = createApi(config.namespace);
await runMigrations(config.databaseUrl, config.migrationsPath);
const { db, sql } = createDb(config.databaseUrl);

const k8sCleanupSub = startK8sCleanupSaga(createK8sClient(api, config.namespace));
const channelCleanupSub = startChannelCleanupSaga(deleteChannelsByInstance(db));
const onecliSyncSub = startOnecliSyncSaga(onecli);

const systemInstances = composeSystemInstances(api, config.namespace, db);
const persistSession = upsertSession(db);

const identityLinkService = createIdentityLinkService({
  find: findIdentityLink(db),
  upsert: upsertIdentityLink(db),
  delete: deleteIdentityLink(db),
});

const pendingSlackOAuthFlows = new Map<string, SlackOAuthPending>();
const pendingChannelOAuthFlows = new Map<string, PendingOAuthFlow>();

const slackOauthCallbackUrl = config.slackOauthCallbackUrl
  ?? `${config.uiBaseUrl}/api/slack/oauth/callback`;
const channelOauthCallbackUrl = config.channelOauthCallbackUrl
  ?? `${config.uiBaseUrl}/api/channel/oauth/callback`;

const fetchChannelsForManager = listChannelsByInstance(db, "");

const channelManager = createChannelManager({
  slackWorker: config.slackBotToken && config.slackAppToken
    ? createSlackWorker(
        config.namespace,
        config.slackBotToken,
        config.slackAppToken,
        () => systemInstances,
        persistSession,
        identityLinkService,
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: slackOauthCallbackUrl,
        },
        pendingSlackOAuthFlows,
      )
    : undefined,
  telegramWorker: config.telegramEnabled
    ? createTelegramWorker(
        config.namespace,
        () => systemInstances,
        persistSession,
        identityLinkService,
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: channelOauthCallbackUrl,
        },
        pendingChannelOAuthFlows,
      )
    : undefined,
  unifiedWorker: config.unifiedChannelEnabled
    ? createUnifiedWorker(
        config.namespace,
        () => systemInstances,
        persistSession,
        identityLinkService,
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: channelOauthCallbackUrl,
        },
        pendingChannelOAuthFlows,
      )
    : undefined,
  fetchChannels: fetchChannelsForManager,
});

const { server: apiServer } = startApiServerApp({
  config,
  api,
  db,
  onecli,
  channelManager,
  identityLinkService,
  pendingSlackOAuthFlows,
  pendingChannelOAuthFlows,
});

const { server: harnessApiServer } = startHarnessApiServerApp({
  config, api, db, channelManager,
});

systemInstances.list().then((all) => {
  channelManager.bootstrap(all).catch(() => {});
}).catch(() => {});

async function shutdown() {
  process.stderr.write("shutting down...\n");
  k8sCleanupSub.unsubscribe();
  channelCleanupSub.unsubscribe();
  onecliSyncSub.unsubscribe();
  await channelManager.stopAll();
  await sql.end();
  harnessApiServer.close();
  apiServer.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
