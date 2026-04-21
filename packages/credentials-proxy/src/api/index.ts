import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createDb } from "db";
import { loadApiConfig } from "./config.js";
import { loadKeyRingFromEnv } from "../crypto/key.js";
import { loadCaFromFiles } from "../crypto/ca.js";
import { createAuthMiddleware } from "./auth.js";
import { caRoutes } from "./routes/ca.js";
import { agentsRoutes } from "./routes/agents.js";
import { secretsRoutes } from "./routes/secrets.js";
import { grantsRoutes } from "./routes/grants.js";
import { oauthRoutes } from "./routes/oauth.js";
import { loadMacKey } from "./oauth/state.js";

const config = loadApiConfig();
const keyRing = loadKeyRingFromEnv();
const { db, sql } = createDb(config.databaseUrl);
const ca = await loadCaFromFiles(config.caCertPath, config.caKeyPath);

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));
app.use("/api/*", createAuthMiddleware(config.keycloak));

const macKey = loadMacKey();
const callbackUrl =
  process.env.OAUTH_CALLBACK_URL ??
  `${process.env.API_PUBLIC_URL ?? "http://localhost:10254"}/api/oauth/callback`;

app.route("/api/gateway/ca", caRoutes(ca));
app.route("/api/agents", agentsRoutes(db, keyRing));
app.route("/api/secrets", secretsRoutes(db, keyRing));
app.route("/api/agents", grantsRoutes(db, keyRing));
app.route("/api/oauth", oauthRoutes({ db, keyRing, macKey, callbackUrl }));

const server = serve({ fetch: app.fetch, port: config.listenPort }, (info) => {
  process.stderr.write(`[api] listening on :${info.port}\n`);
});

async function shutdown() {
  process.stderr.write("[api] shutting down...\n");
  server.close();
  await sql.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
