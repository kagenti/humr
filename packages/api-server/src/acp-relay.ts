import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";
import { LABEL_AGENT_REF } from "./modules/agents/infrastructure/labels.js";
import { buildJob, type JobBuilderConfig } from "./modules/agents/infrastructure/job-builder.js";
import { isPodReady } from "./modules/agents/infrastructure/configmap-mappers.js";

const WAKE_POLL_MS = 500;
const WAKE_TIMEOUT_MS = 120_000;

/**
 * Wait for the Job's pod to become Ready and return its IP.
 * Returns null if timeout expires.
 */
async function waitForJobPodReady(
  k8s: K8sClient,
  jobName: string,
): Promise<string | null> {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pods = await k8s.listPods(`job-name=${jobName}`);
    const pod = pods[0];
    if (pod && isPodReady(pod) && pod.status?.podIP) {
      return pod.status.podIP;
    }
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
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

export function createAcpRelay(
  k8s: K8sClient,
  jobCfg: JobBuilderConfig,
) {
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    instanceId: string,
  ) {
    wss.handleUpgrade(req, socket, head, (client) => {
      // Buffer messages while we spin up the Job
      const pending: { data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }[] = [];
      client.on("message", (data, isBinary) => {
        pending.push({ data: data as Buffer, isBinary });
      });

      launchAndConnect(k8s, jobCfg, instanceId)
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
          process.stderr.write(`[acp-relay] Job launch failed: ${err}\n`);
          client.close(1011, "failed to start agent job");
        });
    });
  }

  return { handleUpgrade };
}

/**
 * Create a Job for this turn, wait for pod readiness, connect WebSocket.
 * If a Job is already running for this instance, connect to it instead.
 */
async function launchAndConnect(
  k8s: K8sClient,
  jobCfg: JobBuilderConfig,
  instanceId: string,
): Promise<WebSocket> {
  // Check for an already-running Job
  const existingJobs = await k8s.listJobs(`humr.ai/instance=${instanceId}`);
  const activeJob = existingJobs.find(
    (j) => !j.status?.succeeded && !j.status?.failed,
  );

  let jobName: string;

  if (activeJob) {
    // Reuse existing active Job
    jobName = activeJob.metadata!.name!;
  } else {
    // Resolve agent ConfigMap to build Job spec
    const instanceCM = await k8s.getConfigMap(instanceId);
    if (!instanceCM) throw new Error(`instance ${instanceId} not found`);

    const agentName = instanceCM.metadata?.labels?.[LABEL_AGENT_REF];
    if (!agentName) throw new Error(`instance ${instanceId} has no agent label`);

    const agentCM = await k8s.getConfigMap(agentName);
    if (!agentCM) throw new Error(`agent ${agentName} not found`);

    const job = buildJob({
      instanceName: instanceId,
      instanceCM,
      agentCM,
      cfg: jobCfg,
    });

    const created = await k8s.createJob(job);
    jobName = created.metadata!.name!;
  }

  // Wait for pod to be ready
  const podIP = await waitForJobPodReady(k8s, jobName);
  if (!podIP) {
    throw new Error(`Job ${jobName} pod did not become ready within ${WAKE_TIMEOUT_MS / 1000}s`);
  }

  return connectUpstream(`ws://${podIP}:8080/api/acp`);
}
