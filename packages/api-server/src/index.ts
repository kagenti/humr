import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, type ApiContext } from "api-server-api";
import { createApi, createK8sTemplatesContext, createK8sInstancesContext } from "./k8s.js";

const namespace = process.env.NAMESPACE ?? "humr-agents";
const port = Number(process.env.PORT ?? 4000);

const { api } = createApi(namespace);
const templates = createK8sTemplatesContext(namespace, api);
const instances = createK8sInstancesContext(namespace, api, templates);

const app = new Hono();

app.all("/api/trpc/*", (c) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (): ApiContext => ({ templates, instances }),
  }),
);

serve({ fetch: app.fetch, port }, () => {
  process.stderr.write(`api-server listening on http://localhost:${port}\n`);
});
