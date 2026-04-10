import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type ApiContext } from "api-server-api";
import { createApi, createK8sTemplatesContext, createK8sInstancesContext, createK8sSchedulesContext } from "./k8s.js";
import { createAcpRelay } from "./acp-relay.js";
import { createTrpcRelay } from "./trpc-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import { createSlackBotManager } from "./slack-bot.js";

const namespace = process.env.NAMESPACE ?? "humr-agents";
const port = Number(process.env.PORT ?? 4000);

const { api } = createApi(namespace);
const slackBots = createSlackBotManager(namespace);
const templates = createK8sTemplatesContext(namespace, api);
const instances = createK8sInstancesContext(namespace, api, templates, slackBots);
const schedules = createK8sSchedulesContext(namespace, api, instances);

const app = new Hono();

// OAuth flow for custom MCP server authentication
const uiBaseUrl = process.env.UI_BASE_URL ?? "http://humr.localhost:4444";
app.route("/", createOAuthRoutes(uiBaseUrl));

app.all("/api/instances/:id/trpc/*", createTrpcRelay(namespace));

app.all("/api/trpc/*", (c) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): ApiContext => ({ templates, instances, schedules }),
  }),
);

const server = serve({ fetch: app.fetch, port }, () => {
  process.stderr.write(`api-server listening on http://localhost:${port}\n`);
});

const acpRelay = createAcpRelay(namespace, api);

instances.list().then((all) => {
  for (const inst of all) {
    if (inst.spec.slackConfig) {
      slackBots.start(inst.name, inst.spec.slackConfig.botToken, inst.spec.slackConfig.appToken);
    }
  }
});

async function shutdown() {
  process.stderr.write("shutting down...\n");
  await slackBots.stopAll();
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
