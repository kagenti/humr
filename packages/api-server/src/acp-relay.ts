import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { eq } from "drizzle-orm";
import type { Db } from "db";
import { instances, agents } from "db";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";
import { buildJob, type JobBuilderConfig, type AgentSpec } from "./modules/agents/infrastructure/job-builder.js";

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 120_000;

function isPodReady(pod: { status?: { conditions?: { type: string; status: string }[]; podIP?: string } }): boolean {
  return pod.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false;
}

function connectUpstream(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", (err) => { ws.close(); reject(err); });
  });
}

async function waitForJobPodIP(k8s: K8sClient, jobName: string): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pods = await k8s.listPods(`job-name=${jobName}`);
    const pod = pods[0];
    if (pod && isPodReady(pod) && pod.status?.podIP) return pod.status.podIP;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

export function createAcpRelay(k8s: K8sClient, jobCfg: JobBuilderConfig, db: Db) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, instanceId: string) {
    wss.handleUpgrade(req, socket, head, (client) => {
      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => { pending.push({ data: data as Buffer, isBinary }); });

      createJobAndConnect(k8s, jobCfg, db, instanceId)
        .then((upstream) => {
          for (const msg of pending) {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(msg.data, { binary: msg.isBinary });
          }
          pending.length = 0;

          client.removeAllListeners("message");
          client.on("message", (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
          });
          upstream.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
          });
          upstream.on("close", (code, reason) => {
            if (client.readyState === WebSocket.OPEN) client.close(code || 1011, reason.toString() || "upstream closed");
          });
          upstream.on("error", () => {
            if (client.readyState === WebSocket.OPEN) client.close(1011, "upstream error");
          });
          client.on("close", () => {
            if (upstream.readyState === WebSocket.OPEN) upstream.close();
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

async function createJobAndConnect(
  k8s: K8sClient,
  jobCfg: JobBuilderConfig,
  db: Db,
  instanceId: string,
): Promise<WebSocket> {
  const [inst] = await db.select().from(instances).where(eq(instances.id, instanceId));
  if (!inst) throw new Error(`instance ${instanceId} not found`);

  const [agent] = await db.select().from(agents).where(eq(agents.id, inst.agentId));
  if (!agent) throw new Error(`agent ${inst.agentId} not found`);

  const job = buildJob({
    instanceId,
    agentId: agent.id,
    agentSpec: agent.spec as AgentSpec,
    cfg: jobCfg,
  });
  const created = await k8s.createJob(job);
  const jobName = created.metadata!.name!;

  const podIP = await waitForJobPodIP(k8s, jobName);
  if (!podIP) throw new Error(`Job ${jobName} pod did not become ready within ${POLL_TIMEOUT_MS / 1000}s`);

  return connectUpstream(`ws://${podIP}:8080/api/acp`);
}
