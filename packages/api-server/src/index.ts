import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type ApiContext, type UserIdentity } from "api-server-api";
import {
  createApi,
  verifyOwner, podBaseUrl,
  patchPodAnnotation, removePodAnnotation, patchConfigMapAnnotation,
} from "./modules/agents/infrastructure/k8s.js";
import { composeAgentsModule, composeSystemInstances } from "./modules/agents/index.js";
import { createSlackWorker } from "./modules/channels/infrastructure/slack.js";
import { createChannelManager } from "./modules/channels/services/ChannelManager.js";
import { createAcpRelay } from "./acp-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import { loadConfig } from "./config.js";
import { createAuth } from "./auth.js";
import { createOnecliClient } from "./onecli.js";

const config = loadConfig();

const auth = createAuth({
  issuerUrl: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
  jwksUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/certs`,
  audience: config.keycloakApiAudience,
});

const onecli = createOnecliClient({
  keycloakTokenUrl: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`,
  clientId: config.keycloakApiClientId,
  clientSecret: config.keycloakApiClientSecret,
  onecliAudience: config.onecliAudience,
  onecliBaseUrl: config.onecliBaseUrl,
});

const { api } = createApi(config.namespace);

const systemInstances = composeSystemInstances(api, config.namespace);

const channelManager = createChannelManager({
  slackWorker: config.slackAppToken
    ? createSlackWorker(config.namespace, config.slackAppToken, () => systemInstances)
    : undefined,
});

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

const verify = verifyOwner(api, config.namespace);

app.all("/api/instances/:id/trpc/*", async (c) => {
  const user = c.get("user");
  const instanceId = c.req.param("id")!;
  if (!await verify(instanceId, user.sub)) {
    return c.json({ error: "not found" }, 404);
  }

  const rest = c.req.path.replace(`/api/instances/${instanceId}/trpc`, "");
  const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
  const upstreamUrl = `http://${podBaseUrl(instanceId, config.namespace)}/api/trpc${rest}${qs}`;
  try {
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    const upstream = await fetch(upstreamUrl, {
      method: c.req.method,
      headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
      // @ts-expect-error -- node fetch supports duplex
      duplex: "half",
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch {
    return c.json({ error: "instance unreachable" }, 502);
  }
});

app.all("/api/trpc/*", (c) => {
  const user = c.get("user");

  const { templates, agents, instances, schedules } = composeAgentsModule(api, config.namespace, user.sub);

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): ApiContext => ({
      templates,
      agents,
      instances,
      schedules,
      channels: { available: channelManager.availableChannels() },
      user,
    }),
  });
});

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  process.stderr.write(`api-server listening on http://localhost:${config.port}\n`);
});

const acpRelay = createAcpRelay(config.namespace, api);

systemInstances.list().then((all) => {
  channelManager.bootstrap(all);
}).catch(() => {});

async function shutdown() {
  process.stderr.write("shutting down...\n");
  await channelManager.stopAll();
  server.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

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
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const instanceId = decodeURIComponent(match[1]);
  if (!await verify(instanceId, user.sub)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  acpRelay.handleUpgrade(req, socket, head, instanceId);
});

export { patchPodAnnotation, removePodAnnotation, patchConfigMapAnnotation, podBaseUrl, createApi };
