import { Hono } from "hono";
import type { Ca } from "../../crypto/ca.js";

export function caRoutes(ca: Ca) {
  return new Hono().get("/", (c) => {
    return c.text(ca.certPem, 200, { "content-type": "application/x-pem-file" });
  });
}
