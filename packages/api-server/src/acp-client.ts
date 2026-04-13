import { WebSocket } from "ws";
import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type { InstancesService } from "api-server-api";
import { podBaseUrl } from "./k8s.js";

const TIMEOUT_MS = 120_000;
const WAKE_POLL_INTERVAL_MS = 2_000;
const WAKE_TIMEOUT_MS = 60_000;

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.on("message", (data) => controller.enqueue(JSON.parse(data.toString())));
          ws.on("close", () => {
            try { controller.close(); } catch {}
          });
          ws.on("error", (err) => {
            try { controller.error(err); } catch {}
          });
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) { ws.send(JSON.stringify(chunk)); },
        close() { ws.close(); },
      });
      resolve({ stream: { readable, writable }, ws });
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureRunning(
  instances: InstancesService,
  name: string,
): Promise<void> {
  const inst = await instances.get(name);
  if (!inst) throw new Error(`Instance "${name}" not found`);

  if (inst.spec.desiredState === "hibernated") {
    await instances.wake(name);
  }

  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await instances.get(name);
    if (current?.status?.podReady) return;
    await sleep(WAKE_POLL_INTERVAL_MS);
  }
  throw new Error(`Instance "${name}" pod not ready within ${WAKE_TIMEOUT_MS / 1000}s`);
}

export async function sendPrompt(
  namespace: string,
  instanceName: string,
  prompt: string,
): Promise<string> {
  const url = `ws://${podBaseUrl(instanceName, namespace)}/api/acp`;
  const { stream, ws } = await wsStream(url);

  const responseChunks: string[] = [];
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params: any) {
        return {
          outcome: {
            outcome: "selected" as const,
            optionId: params.options[0].optionId,
          },
        };
      },
      async sessionUpdate(params: any) {
        if (params.update?.sessionUpdate === "agent_message_chunk" && params.update.content?.type === "text") {
          responseChunks.push(params.update.content.text);
        }
      },
      async writeTextFile() { return {}; },
      async readTextFile() { return { content: "" }; },
    }),
    stream,
  );

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const cleanup = () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  try {
    timeout.addEventListener("abort", cleanup, { once: true });

    await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: "humr-slack", version: "1.0.0" },
    });

    const { sessionId } = await connection.newSession({
      cwd: ".",
      mcpServers: [],
    });

    await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });

    return responseChunks.join("");
  } finally {
    timeout.removeEventListener("abort", cleanup);
    cleanup();
  }
}
