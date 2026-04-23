import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from "node:http";
import { createSecureContext, TLSSocket } from "node:tls";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import { validateDestination } from "./ssrf.js";
import { findRule, type CacheSnapshot } from "./cache.js";
import type { LeafCache } from "../crypto/leaf.js";

export interface ProxyOptions {
  leafCache: LeafCache;
  getSnapshot: () => CacheSnapshot;
  extraBlockedCidrs: string[];
}

interface ConnectTarget {
  host: string;
  port: number;
  resolvedIp: string;
}

// Stash the CONNECT target on the upgraded TLSSocket so the inner HTTP handler
// can pin upstream to the same host+IP (defeats Host-header spoofing).
const TARGET = Symbol("humrTarget");
type TaggedSocket = TLSSocket & { [TARGET]?: ConnectTarget };

export function createProxyServer(opts: ProxyOptions): HttpServer {
  const innerHttp = createHttpServer();

  innerHttp.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const target = (req.socket as TaggedSocket)[TARGET];
    if (!target) {
      res.writeHead(500).end("missing CONNECT target");
      return;
    }

    const rule = findRule(opts.getSnapshot(), target.host);
    const outHeaders: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) outHeaders[k] = v;
    }
    outHeaders.host = target.host;
    if (rule) {
      outHeaders[rule.headerName.toLowerCase()] = rule.headerValue;
    }

    const upstream = httpsRequest(
      {
        host: target.resolvedIp,
        servername: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: outHeaders,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );

    upstream.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
      }
      res.end(`upstream error: ${err.message}\n`);
    });

    req.pipe(upstream);
  });

  innerHttp.on("clientError", (_err, socket) => {
    socket.destroy();
  });

  const outer = createHttpServer();

  outer.on("connect", async (req, clientSocket: Socket) => {
    const url = req.url ?? "";
    const colon = url.lastIndexOf(":");
    const host = colon === -1 ? url : url.slice(0, colon);
    const port = colon === -1 ? 443 : Number(url.slice(colon + 1));

    const check = await validateDestination(host, port, {
      extraBlockedCidrs: opts.extraBlockedCidrs,
    });
    if (!check.ok) {
      clientSocket.write(
        `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n${check.reason}\n`,
      );
      clientSocket.end();
      return;
    }

    let leaf;
    try {
      leaf = await opts.leafCache.get(host);
    } catch (err) {
      clientSocket.write(
        `HTTP/1.1 500 Internal Server Error\r\n\r\nleaf mint failed: ${(err as Error).message}\n`,
      );
      clientSocket.end();
      return;
    }

    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    const tlsSocket = new TLSSocket(clientSocket, {
      isServer: true,
      secureContext: createSecureContext({ cert: leaf.certPem, key: leaf.keyPem }),
    }) as TaggedSocket;

    tlsSocket[TARGET] = { host, port, resolvedIp: check.resolvedIp };
    tlsSocket.on("error", () => tlsSocket.destroy());
    innerHttp.emit("connection", tlsSocket);
  });

  // Agents using HTTP_PROXY for plain-HTTP requests send them as absolute-URI
  // requests directly to the proxy (no CONNECT). Forward those through the
  // same injection logic over HTTP upstream.
  outer.on("request", async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "");
      if (url.protocol !== "http:") {
        res.writeHead(400).end("only http:// is handled on the plain path");
        return;
      }
      const host = url.hostname;
      const port = Number(url.port) || 80;
      const check = await validateDestination(host, port, {
        extraBlockedCidrs: opts.extraBlockedCidrs,
      });
      if (!check.ok) {
        res.writeHead(403, { "content-type": "text/plain" }).end(`${check.reason}\n`);
        return;
      }

      const rule = findRule(opts.getSnapshot(), host);
      const outHeaders: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined && k !== "proxy-connection" && k !== "proxy-authorization") {
          outHeaders[k] = v;
        }
      }
      outHeaders.host = host;
      if (rule) outHeaders[rule.headerName.toLowerCase()] = rule.headerValue;

      // Dynamic import to keep node:http's plain-HTTP request code path lazy.
      const { request: httpRequest } = await import("node:http");
      const upstream = httpRequest(
        {
          host: check.resolvedIp,
          port,
          method: req.method,
          path: `${url.pathname}${url.search}`,
          headers: outHeaders,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstream.on("error", (err) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
        res.end(`upstream error: ${err.message}\n`);
      });
      req.pipe(upstream);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(`bad request: ${(err as Error).message}\n`);
    }
  });

  outer.on("clientError", (_err, socket) => {
    socket.destroy();
  });

  return outer;
}
