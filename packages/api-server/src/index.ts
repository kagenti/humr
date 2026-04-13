import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type ApiContext, type UserIdentity } from "api-server-api";
import {
  createApi,
  createK8sTemplatesContext,
  createK8sAgentsContext,
  createK8sInstancesContext,
  createK8sSchedulesContext,
  createSystemInstancesContext,
  verifyInstanceOwner,
  podBaseUrl,
} from "./k8s.js";
import { createAcpRelay } from "./acp-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import { createSlackChannelManager, type ChannelManager } from "./channels/index.js";
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

const managers: ChannelManager[] = [];
const systemInstances = createSystemInstancesContext(config.namespace, api);
if (config.slackAppToken) {
  managers.push(
    createSlackChannelManager(config.namespace, config.slackAppToken, {
      // Channels are background workers that operate across all users — use the
      // system-scoped instances service to look up any instance by name.
      instances: () => systemInstances,
    }),
  );
}

const app = new Hono<{ Variables: { user: UserIdentity } }>();

// Public endpoints (no auth required)
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/auth/config", (c) =>
  c.json({
    issuer: `${config.keycloakExternalUrl}/realms/${config.keycloakRealm}`,
    clientId: config.keycloakClientId,
    onecliUrl: config.onecliExternalUrl,
  }),
);

// JWT auth middleware for all /api/* routes (skips public paths)
app.use("/api/*", auth.middleware);

// OAuth flow for custom MCP server authentication
app.route("/", createOAuthRoutes(config.uiBaseUrl, onecli));

// Instance tRPC relay — id is the K8s name, verify ownership then forward
app.all("/api/instances/:id/trpc/*", async (c) => {
  const user = c.get("user");
  const instanceId = c.req.param("id")!;
  if (!await verifyInstanceOwner(api, config.namespace, instanceId, user.sub)) {
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
  const templates = createK8sTemplatesContext(config.namespace, api);
  const agents = createK8sAgentsContext(config.namespace, api, user.sub);
  const instances = createK8sInstancesContext(config.namespace, api, user.sub, managers);
  const schedules = createK8sSchedulesContext(config.namespace, api, user.sub);

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): ApiContext => ({
      templates,
      agents,
      instances,
      schedules,
      channels: { available: Object.fromEntries(managers.map(m => [m.type, true])) },
      user,
    }),
  });
});

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  process.stderr.write(`api-server listening on http://localhost:${config.port}\n`);
});

const acpRelay = createAcpRelay(config.namespace, api);

// On startup, restart channel workers for all instances that have channels configured.
if (managers.length > 0) {
  systemInstances.list().then((all) => {
    for (const inst of all) {
      for (const channel of inst.spec.channels ?? []) {
        const mgr = managers.find(m => m.type === channel.type);
        if (mgr) mgr.start(inst.id, channel);
      }
    }
  }).catch(() => {
    // Best-effort startup; channels will reconnect on next user action
  });
}

async function shutdown() {
  process.stderr.write("shutting down...\n");
  await Promise.all(managers.map(m => m.stopAll()));
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
  if (!await verifyInstanceOwner(api, config.namespace, instanceId, user.sub)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  acpRelay.handleUpgrade(req, socket, head, instanceId);
});
