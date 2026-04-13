import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 600_000,
    globalSetup: "./src/__tests__/helpers/test-cluster.ts",
    setupFiles: "./src/__tests__/helpers/worker-setup.ts",
  },
});
