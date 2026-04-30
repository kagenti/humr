import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import type { ExtAuthzGate } from "../../modules/approvals/compose.js";

/** The Envoy sidecar adds this header in the ext_authz request via
 *  `headers_to_add` in its bootstrap; the controller renders the instance
 *  id in at pod-template time. Pod-IP-to-instance race (ADR-033 §"Topology")
 *  is sidestepped because identity is structural, not resolved at request
 *  time. */
const INSTANCE_HEADER = "x-humr-instance";

/** Envoy forwards the original request's authority/host as `:authority`
 *  pseudo-header for HTTP/2 and as the `Host` header for HTTP/1.1. The
 *  ext_authz HTTP service is HTTP/1.1, so `host` is what we get here in
 *  practice — but we also probe `:authority` defensively, behind a
 *  try/catch because Node's WHATWG `Headers.get` throws on names that
 *  start with `:`. */
function getRequestHost(headers: Headers): string | null {
  try {
    const auth = headers.get(":authority");
    if (auth) return auth;
  } catch {
    // Pseudo-header not surfaced via Headers — fall through to `host`.
  }
  return headers.get("host");
}

export interface ExtAuthzAppDeps {
  port: number;
  /** Bound for HTTP timeout sizing — must exceed the gate's hold deadline
   *  so the OS doesn't drop the held connection mid-wait. */
  holdSeconds: number;
  gate: ExtAuthzGate;
}

/**
 * HTTP ext_authz endpoint for Envoy. Envoy forwards the original
 * method/path/headers; the auth service replies 200 = ALLOW or 403 = DENY.
 * All HITL state and signaling lives in the approvals module; this app is
 * purely the HTTP shape.
 */
export function startExtAuthzApp(deps: ExtAuthzAppDeps) {
  const app = new Hono();

  app.get("/healthz", (c) => c.text("ok"));

  app.all("/*", async (c) => {
    const instanceId = c.req.header(INSTANCE_HEADER);
    if (!instanceId) return c.text("missing instance header", 400);

    const host = getRequestHost(c.req.raw.headers);
    if (!host) return c.text("missing host", 400);

    const verdict = await deps.gate.gateRequest({
      instanceId,
      host,
      method: c.req.method.toUpperCase(),
      path: new URL(c.req.url).pathname,
    });
    return c.text(verdict, verdict === "allow" ? 200 : 403);
  });

  const server = serve({ fetch: app.fetch, port: deps.port }, () => {
    process.stderr.write(`ext-authz listening on http://localhost:${deps.port}\n`);
  });

  // Hold up to deps.holdSeconds (default 30 minutes) — keep TCP and Node
  // http timeouts ahead of the application-level hold so the OS doesn't
  // drop the connection mid-wait. The hono/node-server `serve()` return
  // type is a union covering http2 variants we don't use; narrow to
  // `node:http` Server so the timeout properties are visible.
  const headroomMs = (deps.holdSeconds + 60) * 1000;
  const httpServer = server as unknown as Server;
  httpServer.requestTimeout = headroomMs;
  httpServer.headersTimeout = headroomMs;
  httpServer.keepAliveTimeout = headroomMs;

  return { server };
}
