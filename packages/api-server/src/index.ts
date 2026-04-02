import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router.js";
import { createK8sTemplatesContext } from "./k8s.js";
import type { ApiContext } from "./context.js";

const namespace = process.env.NAMESPACE ?? "adk-agents";
const port = Number(process.env.PORT ?? 4000);

const templates = createK8sTemplatesContext(namespace);

const app = new Hono();

app.all("/api/trpc/*", (c) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): ApiContext => ({ templates }),
  }),
);

serve({ fetch: app.fetch, port }, () => {
  process.stderr.write(`api-server listening on http://localhost:${port}\n`);
});
