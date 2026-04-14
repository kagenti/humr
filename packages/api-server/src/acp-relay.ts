import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";
import { podBaseUrl } from "./modules/agents/infrastructure/k8s.js";
import { setDesiredState, parseInfraInstance, isPodReady } from "./modules/agents/domain/configmap-mappers.js";
import { LAST_ACTIVITY_KEY, ACTIVE_SESSION_KEY } from "./modules/agents/domain/labels.js";

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
  k8s: K8sClient,
  instanceId: string,
): Promise<boolean> {
  const podName = `${instanceId}-0`;
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pod = await k8s.getPod(podName);
    if (pod && isPodReady(pod)) return true;
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
  }
  return false;
}

async function patchCmAnnotation(
  k8s: K8sClient,
  name: string,
  key: string,
  value: string,
): Promise<void> {
  const cm = await k8s.getConfigMap(name);
  if (!cm) return;
  if (!cm.metadata!.annotations) cm.metadata!.annotations = {};
  cm.metadata!.annotations[key] = value;
  await k8s.replaceConfigMap(name, cm);
}

async function wakeIfHibernated(k8s: K8sClient, instanceId: string): Promise<boolean> {
  const cm = await k8s.getConfigMap(instanceId);
  if (!cm) return false;
  const infra = parseInfraInstance(cm);
  if (infra.desiredState !== "hibernated") return true;

  const woken = setDesiredState(cm, "running");
  await k8s.replaceConfigMap(cm.metadata!.name!, woken);
  return true;
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

export function createAcpRelay(namespace: string, k8s: K8sClient) {
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
      patchCmAnnotation(k8s, instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

      // Buffer client messages until upstream is connected
      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      connectUpstream(upstreamUrl)
        .catch(async () => {
          const woken = await wakeIfHibernated(k8s, instanceId);
          if (woken) {
            const ready = await waitForPodReady(k8s, instanceId);
            if (!ready) throw new Error("pod did not become ready after wake");
          }
          return connectUpstream(upstreamUrl);
        })
        .then((upstream) => {
          patchCmAnnotation(k8s, instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

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
                patchCmAnnotation(
                  k8s, instanceId,
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
            patchCmAnnotation(k8s, instanceId, ACTIVE_SESSION_KEY, "").catch(() => {});
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
