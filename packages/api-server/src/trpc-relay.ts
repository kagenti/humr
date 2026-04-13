import type { Context } from "hono";
import { podBaseUrl } from "./modules/agents/infrastructure/k8s.js";

export function createTrpcRelay(namespace: string) {
  return async (c: Context) => {
    const instanceId = c.req.param("id")!;
    const rest = c.req.path.replace(`/api/instances/${instanceId}/trpc`, "");
    const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
    const upstreamUrl = `http://${podBaseUrl(instanceId, namespace)}/api/trpc${rest}${qs}`;

    try {
      const headers = new Headers(c.req.raw.headers);
      headers.delete("host");

      const upstream = await fetch(upstreamUrl, {
        method: c.req.method,
        headers,
        body: c.req.method !== "GET" && c.req.method !== "HEAD"
          ? c.req.raw.body
          : undefined,
        // @ts-expect-error -- node fetch supports duplex
        duplex: "half",
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch {
      return c.json({ error: "instance unreachable" }, 502);
    }
  };
}
