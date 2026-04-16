import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 120_000;

// Annotation keys — must match controller constants.
const ANN_RUN_REQUEST = "humr.ai/run-request";
const ANN_ACTIVE_JOB = "humr.ai/active-job";
const ANN_POD_IP = "humr.ai/pod-ip";

/**
 * Poll the instance ConfigMap until the controller writes a pod IP,
 * or a pod IP is already present from an existing active Job.
 */
async function waitForPodIP(
  k8s: K8sClient,
  instanceId: string,
): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const cm = await k8s.getConfigMap(instanceId);
    const ip = cm?.metadata?.annotations?.[ANN_POD_IP];
    if (ip) return ip;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
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

export function createAcpRelay(k8s: K8sClient) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      // Buffer messages while we wait for the Job pod
      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      requestAndConnect(k8s, instanceId)
        .then((upstream) => {
          // Flush buffered messages
          for (const msg of pending) {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(msg.data, { binary: msg.isBinary });
            }
          }
          pending.length = 0;

          // Bidirectional relay
          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary });
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
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.close();
            }
          });
        })
        .catch((err) => {
          process.stderr.write(`[acp-relay] failed: ${err}\n`);
          client.close(1011, "failed to start agent job");
        });
    });
  }

  return { handleUpgrade };
}

/**
 * Request a Job (if not already running) via annotation, wait for pod IP,
 * then connect WebSocket.
 */
async function requestAndConnect(
  k8s: K8sClient,
  instanceId: string,
): Promise<WebSocket> {
  const cm = await k8s.getConfigMap(instanceId);
  if (!cm) throw new Error(`instance ${instanceId} not found`);

  const annotations = cm.metadata?.annotations ?? {};

  // If there's already a pod IP (active Job), connect directly
  if (annotations[ANN_POD_IP]) {
    return connectUpstream(`ws://${annotations[ANN_POD_IP]}:8080/api/acp`);
  }

  // If there's already an active Job but no pod IP yet, just wait for it
  if (annotations[ANN_ACTIVE_JOB]) {
    const podIP = await waitForPodIP(k8s, instanceId);
    if (!podIP) throw new Error(`pod did not become ready for existing job`);
    return connectUpstream(`ws://${podIP}:8080/api/acp`);
  }

  // No active Job — request one via annotation.
  // Use optimistic concurrency: re-read + check before writing to handle races.
  await setRunRequest(k8s, instanceId);

  // Wait for the controller to create the Job and write pod IP
  const podIP = await waitForPodIP(k8s, instanceId);
  if (!podIP) throw new Error(`pod did not become ready within ${POLL_TIMEOUT_MS / 1000}s`);

  return connectUpstream(`ws://${podIP}:8080/api/acp`);
}

/**
 * Atomically set the run-request annotation, retrying on conflict.
 * If another request already set active-job in the meantime, skip.
 */
async function setRunRequest(
  k8s: K8sClient,
  instanceId: string,
  retries = 3,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    const fresh = await k8s.getConfigMap(instanceId);
    if (!fresh) throw new Error(`instance ${instanceId} not found`);

    // Another request won the race — a Job is already being created
    if (fresh.metadata?.annotations?.[ANN_ACTIVE_JOB]) return;
    if (fresh.metadata?.annotations?.[ANN_RUN_REQUEST]) return;

    if (!fresh.metadata!.annotations) fresh.metadata!.annotations = {};
    fresh.metadata!.annotations[ANN_RUN_REQUEST] = new Date().toISOString();
    try {
      await k8s.replaceConfigMap(instanceId, fresh);
      return;
    } catch (err: any) {
      if (err?.code === 409 && i < retries - 1) continue; // conflict — retry
      throw err;
    }
  }
}
