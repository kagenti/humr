import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type ApiContext, type UserIdentity } from "api-server-api";
import { createApi, createK8sTemplatesContext, createK8sInstancesContext, createK8sSchedulesContext, verifyInstanceOwner } from "./k8s.js";
import { createAcpRelay } from "./acp-relay.js";
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

// Instance relay paths — verify ownership and translate to qualified K8s name
app.all("/api/instances/:id/trpc/*", async (c) => {
  const user = c.get("user");
  const instanceId = c.req.param("id")!;
  const qName = await verifyInstanceOwner(api, namespace, instanceId, user.sub, user.preferredUsername);
  if (!qName) return c.json({ error: "not found" }, 404);
  // Rewrite the path to use the qualified name for the upstream relay
  const rest = c.req.path.replace(`/api/instances/${instanceId}/trpc`, "");
  const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
  const upstreamUrl = `http://${qName}-0.${qName}.${namespace}.svc:8080/api/trpc${rest}${qs}`;
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
  const templates = createK8sTemplatesContext(namespace, api, user.sub, user.preferredUsername);
  const instances = createK8sInstancesContext(namespace, api, user.sub, user.preferredUsername);
  const schedules = createK8sSchedulesContext(namespace, api, user.sub, user.preferredUsername);

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

  const instanceId = match[1];
  const qName = await verifyInstanceOwner(api, namespace, instanceId, user.sub, user.preferredUsername);
  if (!qName) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  acpRelay.handleUpgrade(req, socket, head, qName);
});
