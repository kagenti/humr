import { spawn, type ChildProcess } from "node:child_process";
import * as k8s from "@kubernetes/client-node";

const API_PORT = 4111;
const API_URL = `http://localhost:${API_PORT}`;
const TEST_NAMESPACE = "humr-agents-test";
const KUBECONFIG = `${process.env.HOME}/.lima/humr-k3s/copied-from-guest/kubeconfig.yaml`;

let apiProcess: ChildProcess | null = null;

function loadK8sApi() {
  const kc = new k8s.KubeConfig();
  kc.loadFromFile(KUBECONFIG);
  return kc.makeApiClient(k8s.CoreV1Api);
}

async function ensureNamespace(api: k8s.CoreV1Api) {
  try {
    await api.readNamespace({ name: TEST_NAMESPACE });
  } catch {
    await api.createNamespace({ body: { metadata: { name: TEST_NAMESPACE } } });
  }
}

async function deleteNamespace(api: k8s.CoreV1Api) {
  try {
    await api.deleteNamespace({ name: TEST_NAMESPACE });
  } catch {}
}

async function waitForReady(url: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API server not ready after ${timeoutMs}ms`);
}

export async function setup() {
  console.log("Creating test namespace...");
  const api = loadK8sApi();
  await ensureNamespace(api);

  console.log("Starting API server...");
  const serverCwd = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
  apiProcess = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: serverCwd,
    env: {
      ...process.env,
      KUBECONFIG,
      NAMESPACE: TEST_NAMESPACE,
      PORT: String(API_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  apiProcess.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(`[api-server] ${data}`);
  });

  await waitForReady(`${API_URL}/api/trpc/schedules.config`);
  console.log("API server ready.");
}

export async function teardown() {
  if (apiProcess) {
    console.log("Stopping API server...");
    apiProcess.kill("SIGTERM");
    apiProcess = null;
  }

  console.log("Cleaning up test namespace...");
  const api = loadK8sApi();
  await deleteNamespace(api);
}
