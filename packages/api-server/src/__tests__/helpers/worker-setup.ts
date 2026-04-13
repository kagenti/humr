import { beforeAll } from "vitest";
import { waitForKeycloak, getToken } from "./auth.js";
import { setToken } from "./trpc-client.js";

const API_URL = "http://humr-api.localtest.me:5555";

async function waitForReady(url: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`API server not ready after ${timeoutMs}ms`);
}

// Runs once per worker process before any test file executes.
// Must live in setupFiles (not globalSetup) so that setToken() populates
// the module-local token in the worker's copy of trpc-client.
beforeAll(async () => {
  await waitForKeycloak();
  await waitForReady(`${API_URL}/api/health`);
  setToken(await getToken());
}, 180_000);
