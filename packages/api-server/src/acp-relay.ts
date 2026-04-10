import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type * as k8s from "@kubernetes/client-node";
import { podBaseUrl, patchConfigMapAnnotation, wakeInstance } from "./k8s.js";

const LAST_ACTIVITY_KEY = "humr.ai/last-activity";
const ACTIVE_SESSION_KEY = "humr.ai/active-session";
const DEBOUNCE_MS = 30_000;
const WAKE_POLL_MS = 1_000;
const WAKE_TIMEOUT_MS = 120_000;

const lastActivityTimestamps = new Map<string, number>();

function shouldUpdateActivity(instanceId: string): boolean {
  const now = Date.now();
  const last = lastActivityTimestamps.get(instanceId) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastActivityTimestamps.set(instanceId, now);
  return true;
}

async function waitForPodReady(
  api: k8s.CoreV1Api,
  namespace: string,
  instanceId: string,
): Promise<boolean> {
  const podName = `${instanceId}-0`;
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const pod = await api.readNamespacedPod({ name: podName, namespace });
      const ready = pod.status?.conditions?.find((c) => c.type === "Ready");
      if (ready?.status === "True") return true;
    } catch {}
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
  }
  return false;
}

function connectUpstream(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", (err) => {
      ws.close();
      reject(err);
    });
  });
}

export function createAcpRelay(namespace: string, api: k8s.CoreV1Api) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    // Accept the client WebSocket upgrade immediately so it doesn't time out
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/acp`;

      // Mark session active immediately to prevent idle hibernation during connect
      patchConfigMapAnnotation(api, namespace, instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

      // Buffer client messages until upstream is connected
      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      connectUpstream(upstreamUrl)
        .catch(async () => {
          const woke = await wakeInstance(api, namespace, instanceId);
          if (woke) {
            const ready = await waitForPodReady(api, namespace, instanceId);
            if (!ready) throw new Error("pod did not become ready after wake");
          }
          return connectUpstream(upstreamUrl);
        })
        .then((upstream) => {
          patchConfigMapAnnotation(api, namespace, instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

          // Flush buffered messages
          for (const msg of pending) {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(msg.data, { binary: msg.isBinary });
            }
          }
          pending.length = 0;

          // Replace buffer handler with direct relay
          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary });

              if (shouldUpdateActivity(instanceId)) {
                patchConfigMapAnnotation(
                  api, namespace, instanceId,
                  LAST_ACTIVITY_KEY, new Date().toISOString(),
                ).catch(() => {});
              }
            }
          });

          upstream.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data, { binary: isBinary });
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
            patchConfigMapAnnotation(api, namespace, instanceId, ACTIVE_SESSION_KEY, "").catch(() => {});
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.close();
            }
          });
        })
        .catch(() => {
          client.close(1011, "failed to connect to agent");
        });
    });
  }

  return { handleUpgrade };
}
