import { readFile } from "node:fs/promises";
import { loadGatewayConfig } from "./config.js";
import { loadCaFromFiles } from "../crypto/ca.js";
import { createLeafCache } from "../crypto/leaf.js";
import { openSidecarDb, loadGrants } from "./db.js";
import { createProxyServer } from "./proxy.js";
import type { CacheSnapshot } from "./cache.js";

const config = loadGatewayConfig();

const agentDek = await readFile(config.dekPath);
if (agentDek.length !== 32) {
  throw new Error(`agent DEK must be 32 bytes, got ${agentDek.length} at ${config.dekPath}`);
}

const ca = await loadCaFromFiles(config.caCertPath, config.caKeyPath);
const leafCache = createLeafCache(ca);

const { db, close } = openSidecarDb(config.databaseUrl);

let snapshot: CacheSnapshot = await loadGrants(db, config.agentId, agentDek);
process.stderr.write(`[gateway] loaded ${snapshot.rules.length} grant(s) for agent ${config.agentId}\n`);

const refreshTimer = setInterval(async () => {
  try {
    snapshot = await loadGrants(db, config.agentId, agentDek);
  } catch (err) {
    // Fail-open on refresh: keep the prior snapshot rather than flapping
    // in-flight requests. The DB/API being down must not take down credential
    // swapping for cached grants.
    process.stderr.write(`[gateway] grant refresh failed: ${(err as Error).message}\n`);
  }
}, config.refreshIntervalMs);

const server = createProxyServer({
  leafCache,
  getSnapshot: () => snapshot,
  extraBlockedCidrs: config.extraBlockedCidrs,
});

server.listen(config.listenPort, "127.0.0.1", () => {
  process.stderr.write(`[gateway] listening on 127.0.0.1:${config.listenPort}\n`);
});

async function shutdown() {
  process.stderr.write("[gateway] shutting down...\n");
  clearInterval(refreshTimer);
  server.close();
  await close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
