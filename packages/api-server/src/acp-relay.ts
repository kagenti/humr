import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { podBaseUrl } from "./modules/agents/infrastructure/k8s.js";
import type { InstancesRepository } from "./modules/agents/infrastructure/instances-repository.js";
import { LAST_ACTIVITY_KEY, ACTIVE_SESSION_KEY } from "./modules/agents/infrastructure/labels.js";

const DEBOUNCE_MS = 30_000;
const WAKE_POLL_INITIAL_MS = 500;
const WAKE_POLL_MAX_MS = 5_000;
const WAKE_TIMEOUT_MS = 120_000;

const lastActivityTimestamps = new Map<string, number>();

function sanitizeCloseCode(code: number): number {
  if (code === 1000 || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)) return code;
  if (code >= 3000 && code <= 4999) return code;
  return 1011;
}

function shouldUpdateActivity(instanceId: string): boolean {
  const now = Date.now();
  const last = lastActivityTimestamps.get(instanceId) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastActivityTimestamps.set(instanceId, now);
  return true;
}

async function waitForPodReady(
  repo: InstancesRepository,
  instanceId: string,
): Promise<boolean> {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  let interval = WAKE_POLL_INITIAL_MS;
  while (Date.now() < deadline) {
    if (await repo.isPodReady(instanceId)) return true;
    // ±20% jitter so concurrent waiters on the same pod don't poll in lockstep.
    const jittered = interval * (0.8 + 0.4 * Math.random());
    await new Promise((r) => setTimeout(r, jittered));
    interval = Math.min(Math.floor(interval * 1.5), WAKE_POLL_MAX_MS);
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

export function createAcpRelay(namespace: string, repo: InstancesRepository) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstreamUrl = `ws://${podBaseUrl(instanceId, namespace)}/api/acp`;

      repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      connectUpstream(upstreamUrl)
        .catch(async () => {
          const woken = await repo.wakeIfHibernated(instanceId);
          if (woken) {
            const ready = await waitForPodReady(repo, instanceId);
            if (!ready) throw new Error("pod did not become ready after wake");
          }
          return connectUpstream(upstreamUrl);
        })
        .then((upstream) => {
          repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "true").catch(() => {});

          for (const msg of pending) {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(msg.data, { binary: msg.isBinary });
            }
          }
          pending.length = 0;

          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) {
              upstream.send(data, { binary: isBinary });

              if (shouldUpdateActivity(instanceId)) {
                repo.patchAnnotation(
                  instanceId,
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
              try {
                client.close(sanitizeCloseCode(code), reason.toString() || "upstream closed");
              } catch {
                client.terminate();
              }
            }
          });

          upstream.on("error", () => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.close(1011, "upstream error");
              } catch {
                client.terminate();
              }
            }
          });

          client.on("close", () => {
            repo.patchAnnotation(instanceId, ACTIVE_SESSION_KEY, "").catch(() => {});
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
