import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type ApiContext, type UserIdentity } from "api-server-api";
import { createApi, createK8sTemplatesContext, createK8sInstancesContext, createK8sSchedulesContext, verifyInstanceOwner } from "./k8s.js";
import { createAcpRelay } from "./acp-relay.js";
import { createTrpcRelay } from "./trpc-relay.js";
import { createOAuthRoutes } from "./oauth.js";
import { createAuth } from "./auth.js";

const namespace = process.env.NAMESPACE ?? "humr-agents";
const port = Number(process.env.PORT ?? 4000);

const keycloakUrl = process.env.KEYCLOAK_URL ?? "http://humr-keycloak:8080";
const keycloakExternalUrl = process.env.KEYCLOAK_EXTERNAL_URL ?? "http://keycloak.localhost:4444";
const keycloakRealm = process.env.KEYCLOAK_REALM ?? "humr";
const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID ?? "humr-ui";
const keycloakApiAudience = process.env.KEYCLOAK_API_AUDIENCE ?? "humr-api";

const auth = createAuth({
  issuerUrl: `${keycloakExternalUrl}/realms/${keycloakRealm}`,
  jwksUrl: `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`,
  audience: keycloakApiAudience,
});

const { api } = createApi(namespace);

// Templates are shared (no owner scoping)
const templates = createK8sTemplatesContext(namespace, api);

const app = new Hono<{ Variables: { user: UserIdentity } }>();

// Public endpoints (no auth required)
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.get("/api/auth/config", (c) =>
  c.json({
    issuer: `${keycloakExternalUrl}/realms/${keycloakRealm}`,
    clientId: keycloakClientId,
  }),
);

// JWT auth middleware for all /api/* routes (skips public paths)
app.use("/api/*", auth.middleware);

// OAuth flow for custom MCP server authentication
const uiBaseUrl = process.env.UI_BASE_URL ?? "http://humr.localhost:4444";
app.route("/", createOAuthRoutes(uiBaseUrl));

// Instance relay paths — verify ownership before forwarding
app.all("/api/instances/:id/trpc/*", async (c) => {
  const user = c.get("user");
  const instanceId = c.req.param("id")!;
  if (!await verifyInstanceOwner(api, namespace, instanceId, user.sub)) {
    return c.json({ error: "not found" }, 404);
  }
  return createTrpcRelay(namespace)(c);
});

app.all("/api/trpc/*", (c) => {
  const user = c.get("user");
  // Instances and schedules are scoped per-request by owner
  const instances = createK8sInstancesContext(namespace, api, templates, user.sub);
  const schedules = createK8sSchedulesContext(namespace, api, instances, user.sub);

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): ApiContext => ({
      templates,
      instances,
      schedules,
      user,
    }),
  });
});

const server = serve({ fetch: app.fetch, port }, () => {
  process.stderr.write(`api-server listening on http://localhost:${port}\n`);
});

const acpRelay = createAcpRelay(namespace, api);

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

  // Verify instance ownership
  const instanceId = match[1];
  if (!await verifyInstanceOwner(api, namespace, instanceId, user.sub)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  acpRelay.handleUpgrade(req, socket, head, instanceId);
});
