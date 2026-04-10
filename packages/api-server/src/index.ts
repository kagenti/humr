import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type ApiContext } from "api-server-api";
import { createApi, createK8sTemplatesContext, createK8sInstancesContext, createK8sSchedulesContext } from "./k8s.js";
import { createAcpRelay } from "./acp-relay.js";
import { createTrpcRelay } from "./trpc-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import { createSlackChannelManager, type ChannelManager } from "./channels/index.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const { api } = createApi(config.namespace);
const managers: ChannelManager[] = [];
if (config.slackAppToken) managers.push(createSlackChannelManager(config.namespace, config.slackAppToken));
const templates = createK8sTemplatesContext(config.namespace, api);
const instances = createK8sInstancesContext(config.namespace, api, templates, managers);
const schedules = createK8sSchedulesContext(config.namespace, api, instances);

const app = new Hono();

app.route("/", createOAuthRoutes(config.uiBaseUrl));

app.all("/api/instances/:id/trpc/*", createTrpcRelay(config.namespace));

app.all("/api/trpc/*", (c) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): ApiContext => ({ templates, instances, schedules, channels: { available: Object.fromEntries(managers.map(m => [m.type, true])) } }),
  }),
);

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  process.stderr.write(`api-server listening on http://localhost:${config.port}\n`);
});

const acpRelay = createAcpRelay(config.namespace, api);

instances.list().then((all) => {
  for (const inst of all) {
    for (const channel of inst.spec.channels ?? []) {
      const mgr = managers.find(m => m.type === channel.type);
      if (mgr) mgr.start(inst.name, channel);
    }
  }
});

async function shutdown() {
  process.stderr.write("shutting down...\n");
  await Promise.all(managers.map(m => m.stopAll()));
  server.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.on("upgrade", (req, socket, head) => {
  const match = req.url?.match(/^\/api\/instances\/([^/]+)\/acp$/);
  if (match) {
    acpRelay.handleUpgrade(req, socket, head, match[1]);
  } else {
    socket.destroy();
  }
});
