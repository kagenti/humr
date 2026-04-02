import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type * as k8s from "@kubernetes/client-node";
import { podBaseUrl, patchPodAnnotation, removePodAnnotation } from "./k8s.js";

const LAST_ACTIVITY_KEY = "humr.ai/last-activity";
const ACTIVE_SESSION_KEY = "humr.ai/active-session";
const DEBOUNCE_MS = 30_000;

const lastActivityTimestamps = new Map<string, number>();

function shouldUpdateActivity(instanceId: string): boolean {
  const now = Date.now();
  const last = lastActivityTimestamps.get(instanceId) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastActivityTimestamps.set(instanceId, now);
  return true;
}

export function createAcpRelay(namespace: string, api: k8s.CoreV1Api) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/acp`;
    const upstream = new WebSocket(upstreamUrl);

    upstream.on("error", () => {
      socket.destroy();
    });

    upstream.on("open", () => {
      wss.handleUpgrade(req, socket, head, (client) => {
        patchPodAnnotation(api, namespace, instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

        upstream.on("message", (data) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        });

        client.on("message", (data) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data);

            try {
              const msg = JSON.parse(data.toString());
              if (msg.method === "prompt" && shouldUpdateActivity(instanceId)) {
                patchPodAnnotation(
                  api, namespace, instanceId,
                  LAST_ACTIVITY_KEY, new Date().toISOString(),
                ).catch(() => {});
              }
            } catch {}
          }
        });

        upstream.on("close", (code, reason) => {
          if (client.readyState === WebSocket.OPEN) {
            client.close(code || 1011, reason.toString() || "upstream closed");
          }
        });

        upstream.on("error", () => {
          if (client.readyState === WebSocket.OPEN) {
            client.close(1011, "upstream error");
          }
        });

        client.on("close", () => {
          removePodAnnotation(api, namespace, instanceId, ACTIVE_SESSION_KEY).catch(() => {});
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.close();
          }
        });
      });
    });
  }

  return { handleUpgrade };
}
