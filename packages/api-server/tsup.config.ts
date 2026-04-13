import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  platform: "node",
  splitting: false,
  clean: true,
  noExternal: ["api-server-api", "db"],
  external: ["drizzle-orm", "drizzle-orm/postgres-js", "drizzle-orm/postgres-js/migrator", "postgres"],
});
