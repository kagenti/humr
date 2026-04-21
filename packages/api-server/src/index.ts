import { createDb, runMigrations } from "db";
import { createApi } from "./modules/agents/infrastructure/k8s.js";
import { composeSystemInstances, startK8sCleanupSaga, startChannelCleanupSaga } from "./modules/agents/index.js";
import { createK8sClient } from "./modules/agents/infrastructure/k8s.js";
import { createInstancesRepository } from "./modules/agents/infrastructure/instances-repository.js";
import { deleteChannelsByInstance } from "./modules/agents/infrastructure/channels-repository.js";
import { upsertSession, findByInstanceAndThreadTs, findInstanceByThreadTs, touchSession } from "./modules/agents/infrastructure/sessions-repository.js";
import { createSlackWorker, type SlackOAuthPending } from "./modules/channels/infrastructure/slack.js";
import { createChannelManager } from "./modules/channels/services/channel-manager.js";
import { createIdentityLinkService } from "./modules/channels/services/identity-link-service.js";
import {
  findIdentityBySlackUser, upsertIdentityLink, deleteIdentityLink,
} from "./modules/channels/infrastructure/identity-links-repository.js";
import {
  startOnForkReadySaga,
  startOnForkFailedSaga,
} from "./modules/channels/index.js";
import { composeConnectionsModule } from "./modules/connections/index.js";
import {
  composeForksModule,
  startOnForeignReplySaga,
  startOnSlackTurnRelayedSaga,
} from "./modules/forks/index.js";
import { createK8sForkOrchestrator } from "./modules/forks/infrastructure/k8s-fork-orchestrator.js";
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

const k8sClient = createK8sClient(api, config.namespace);
const instancesRepo = createInstancesRepository(k8sClient);

const { foreignCredentials } = composeConnectionsModule({
  foreignCredentialsConfig: {
    keycloakTokenUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
    clientId: config.keycloakApiClientId,
    clientSecret: config.keycloakApiClientSecret,
    onecliAudience: config.onecliAudience,
    onecliBaseUrl: config.onecliBaseUrl,
  },
});

const { forks } = composeForksModule({
  foreignCredentials,
  orchestrator: createK8sForkOrchestrator({ api, namespace: config.namespace }),
});

const onForeignReplySub = startOnForeignReplySaga(forks);
const onSlackTurnRelayedSub = startOnSlackTurnRelayedSaga(forks);

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

const slackWorker = config.slackBotToken && config.slackAppToken
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
        findInstance: findInstanceByThreadTs(db),
        touch: touchSession(db),
      },
      (instanceId) => instancesRepo.getOwner(instanceId),
    )
  : undefined;

const channelManager = createChannelManager({ slackWorker });

const onForkReadySub = slackWorker ? startOnForkReadySaga(slackWorker) : undefined;
const onForkFailedSub = slackWorker ? startOnForkFailedSaga(slackWorker) : undefined;

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
  onForeignReplySub.unsubscribe();
  onSlackTurnRelayedSub.unsubscribe();
  onForkReadySub?.unsubscribe();
  onForkFailedSub?.unsubscribe();
  await channelManager.stopAll();
  await sql.end();
  harnessApiServer.close();
  apiServer.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
