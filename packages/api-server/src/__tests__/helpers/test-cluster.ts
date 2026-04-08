import { execSync } from "node:child_process";

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

export async function setup() {
  console.log("Waiting for API server to be reachable...");
  await waitForReady(`${API_URL}/api/trpc/schedules.config`);
  console.log("Test cluster ready.");
}

export async function teardown() {
  console.log("Deleting test cluster...");
  try {
    execSync(
      "mise run cluster:delete -- --vm-name=humr-k3s-test --force",
      { stdio: "inherit", timeout: 120_000 },
    );
  } catch (e) {
    console.error("Failed to delete test cluster:", e);
  }
}
