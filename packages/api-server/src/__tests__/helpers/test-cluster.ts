import { execSync } from "node:child_process";

export async function setup() {
  // Cluster is brought up by `mise run cluster:install` before vitest runs.
  // Per-worker readiness + token acquisition lives in ./worker-setup.ts
  // (setupFiles), because globalSetup runs in a separate process and cannot
  // seed module state in test workers.
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
