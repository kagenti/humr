import { createDb, runMigrations } from "db";
import { createApi } from "./modules/agents/infrastructure/k8s.js";
import { composeSystemInstances, startK8sCleanupSaga, startChannelCleanupSaga } from "./modules/agents/index.js";
import { createK8sClient } from "./modules/agents/infrastructure/k8s.js";
import { deleteChannelsByInstance } from "./modules/agents/infrastructure/channels-repository.js";
import { upsertSession, findByInstanceAndThreadTs, touchSession } from "./modules/agents/infrastructure/sessions-repository.js";
import { createSlackWorker, type SlackOAuthPending } from "./modules/channels/infrastructure/slack.js";
import { createChannelManager } from "./modules/channels/services/channel-manager.js";
import { createIdentityLinkService } from "./modules/channels/services/identity-link-service.js";
import {
  findIdentityBySlackUser, upsertIdentityLink, deleteIdentityLink,
} from "./modules/channels/infrastructure/identity-links-repository.js";
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
const persistSlackSession: typeof persistSession = (sessionId, instanceId, type, threadTs?) =>
  persistSession(sessionId, instanceId, type, undefined, threadTs);

const identityLinkService = createIdentityLinkService({
  findBySlackUser: findIdentityBySlackUser(db),
  upsert: upsertIdentityLink(db),
  delete: deleteIdentityLink(db),
});

const pendingSlackOAuthFlows = new Map<string, SlackOAuthPending>();

const slackOauthCallbackUrl = config.slackOauthCallbackUrl
  ?? `${config.uiBaseUrl}/api/slack/oauth/callback`;

const channelManager = createChannelManager({
  slackWorker: config.slackBotToken && config.slackAppToken
    ? createSlackWorker(
        config.namespace,
        config.slackBotToken,
        config.slackAppToken,
        () => systemInstances,
        persistSlackSession,
        identityLinkService,
        {
          keycloakExternalUrl: config.keycloakExternalUrl,
          keycloakRealm: config.keycloakRealm,
          keycloakClientId: config.keycloakClientId,
          callbackUrl: slackOauthCallbackUrl,
        },
        pendingSlackOAuthFlows,
        {
          find: findByInstanceAndThreadTs(db),
          touch: touchSession(db),
        },
      )
    : undefined,
});

const { server: apiServer } = startApiServerApp({
  config, api, db, onecli, channelManager, identityLinkService, pendingSlackOAuthFlows,
});

const { server: harnessApiServer } = startHarnessApiServerApp({
  config, api, db, channelManager,
});

systemInstances.list().then((all) => {
  channelManager.bootstrap(all);
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
