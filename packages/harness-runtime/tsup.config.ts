import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/agent.ts"],
  format: "esm",
  target: "node22",
  platform: "node",
  noExternal: ["harness-runtime-api"],
  splitting: false,
  clean: true,
});
