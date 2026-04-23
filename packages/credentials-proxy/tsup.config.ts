import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli/migrate-from-onecli.ts"],
  format: "esm",
  target: "node22",
  platform: "node",
  splitting: false,
  clean: true,
  noExternal: ["db", "drizzle-orm", "postgres"],
});
