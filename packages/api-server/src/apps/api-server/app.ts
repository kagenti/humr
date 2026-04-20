import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "api-server-api/router";
import type { ApiContext, UserIdentity } from "api-server-api";
import type { CoreV1Api, BatchV1Api, NetworkingV1Api } from "@kubernetes/client-node";
import type { Db } from "db";
import {
  createK8sClient,
} from "../../modules/agents/infrastructure/k8s.js";
import { createInstancesRepository } from "./../../modules/agents/infrastructure/instances-repository.js";
import { loadJobBuilderConfig } from "./../../modules/agents/infrastructure/job-builder.js";
import { composeAgentsModule } from "../../modules/agents/index.js";
import { createSlackOAuthRoutes } from "../../modules/channels/infrastructure/slack-oauth.js";
import { createAcpRelay } from "../../acp-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import type { Config } from "../../config.js";
import { createAuth, ForbiddenError } from "../../auth.js";
import type { OnecliClient } from "../../onecli.js";
import { createOnecliSecretsPort } from "./../../modules/secrets/infrastructure/onecli-secrets-port.js";
import { createSecretsService } from "./../../modules/secrets/services/secrets-service.js";
import { createOnecliConnectionsPort } from "./../../modules/connections/infrastructure/onecli-connections-port.js";
import { createConnectionsService } from "./../../modules/connections/services/connections-service.js";
import type { ChannelManager } from "./../../modules/channels/services/channel-manager.js";
import type { IdentityLinkService } from "./../../modules/channels/services/identity-link-service.js";
import type { SlackOAuthPending } from "../../modules/channels/infrastructure/slack.js";

export interface ApiServerAppDeps {
  config: Config;
  api: CoreV1Api;
  batchApi: BatchV1Api;
  networkingApi: NetworkingV1Api;
  db: Db;
  onecli: OnecliClient;
  channelManager: ChannelManager;
  identityLinkService: IdentityLinkService;
  pendingSlackOAuthFlows: Map<string, SlackOAuthPending>;
}

export function startApiServerApp(deps: ApiServerAppDeps) {
  const { config, api, batchApi, networkingApi, db, onecli, channelManager, identityLinkService, pendingSlackOAuthFlows } = deps;

  const k8sClient = createK8sClient(api, config.namespace, batchApi, networkingApi);
  const instancesRepo = createInstancesRepository(db);
  const jobCfg = loadJobBuilderConfig();

  const auth = createAuth({
    issuerUrl: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
    jwksUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`,
    audience: config.keycloakApiAudience,
    requiredRole: config.keycloakRequiredRole,
  });

  const slackOauthCallbackUrl = config.slackOauthCallbackUrl
    ?? `${config.uiBaseUrl}/api/slack/oauth/callback`;

  const app = new Hono<{ Variables: { user: UserIdentity } }>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/auth/config", (c) =>
    c.json({
      issuer: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
      clientId: config.keycloakClientId,
      onecliUrl: config.onecliExternalUrl,
    }),
  );

  app.use("/api/*", auth.middleware);

  app.route("/", createOAuthRoutes(config.uiBaseUrl, onecli));

  if (config.slackBotToken && config.slackAppToken) {
    app.route("/", createSlackOAuthRoutes({
      pendingFlows: pendingSlackOAuthFlows,
      identityLinks: identityLinkService,
      keycloakUrl: config.keycloakUrl,
      keycloakRealm: config.keycloakRealm,
      keycloakClientId: config.keycloakClientId,
      callbackUrl: slackOauthCallbackUrl,
    }));
  }

  async function verifyOwner(instanceId: string, owner: string): Promise<boolean> {
    return instancesRepo.isOwnedBy(instanceId, owner);
  }

  app.all("/api/instances/:id/trpc/*", async (c) => {
    const user = c.get("user");
    const instanceId = c.req.param("id")!;
    if (!await verifyOwner(instanceId, user.sub)) {
      return c.json({ error: "not found" }, 404);
    }

    // One-shot Job model: no persistent pod for tRPC relay
    return c.json({ error: "instance idle — no active agent pod" }, 503);
  });

  app.all("/api/trpc/*", (c) => {
    const user = c.get("user");
    const userJwt = c.req.header("authorization")!.slice(7);

    const { templates, agents, instances, schedules, sessions } = composeAgentsModule(
      api, config.namespace, user.sub, db,
      { onecli, userJwt, batchApi, networkingApi },
    );
    const secrets = createSecretsService({
      port: createOnecliSecretsPort(onecli, userJwt, user.sub),
    });
    const connections = createConnectionsService({
      port: createOnecliConnectionsPort(onecli, userJwt, user.sub),
    });

    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): ApiContext => ({
        templates,
        agents,
        instances,
        schedules,
        sessions,
        secrets,
        channels: { available: channelManager.availableChannels() },
        connections,
        user,
      }),
    });
  });

  const acpRelay = createAcpRelay(k8sClient, jobCfg, db);

  const server = serve({ fetch: app.fetch, port: config.port }, () => {
    process.stderr.write(`api-server listening on http://localhost:${config.port}\n`);
  });

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/api\/instances\/([^/]+)\/acp$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let user: UserIdentity;
    try {
      user = await auth.verify(token);
    } catch (err) {
      const status = err instanceof ForbiddenError ? "403 Forbidden" : "401 Unauthorized";
      socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
      socket.destroy();
      return;
    }

    const instanceId = decodeURIComponent(match[1]);
    if (!await verifyOwner(instanceId, user.sub)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    acpRelay.handleUpgrade(req, socket, head, instanceId);
  });

  return { server };
}
