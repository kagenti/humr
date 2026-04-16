import { WebSocket } from "ws";
import { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import type { InstancesService } from "api-server-api";
import type { K8sClient } from "./modules/agents/infrastructure/k8s.js";

const TIMEOUT_MS = 120_000;

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

export async function ensureRunning(
  instances: InstancesService,
  name: string,
): Promise<void> {
  // In the Job model, instances are always "ready" — Jobs are created on demand.
  // Just verify the instance exists.
  const inst = await instances.get(name);
  if (!inst) throw new Error(`Instance "${name}" not found`);
}

export interface AcpSessionInfo {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface TriggerSessionResult {
  sessionId: string;
  stopReason?: string;
}

export interface AcpClient {
  listSessions(): Promise<AcpSessionInfo[]>;
  sendPrompt(prompt: string): Promise<string>;
  triggerSession(opts: {
    prompt: string;
    resumeSessionId?: string;
    mcpServers?: unknown[];
  }): Promise<TriggerSessionResult>;
}

async function withAcpConnection<T>(
  url: string,
  clientName: string,
  handlers: { sessionUpdate?: (params: any) => Promise<void> },
  fn: (connection: ClientSideConnection) => Promise<T>,
): Promise<T> {
  const { stream, ws } = await wsStream(url);
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params: any) {
        return { outcome: { outcome: "selected" as const, optionId: params.options[0].optionId } };
      },
      async sessionUpdate(params: any) { await handlers.sessionUpdate?.(params); },
      async writeTextFile() { return {}; },
      async readTextFile() { return { content: "" }; },
    }),
    stream,
  );

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const cleanup = () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  try {
    timeout.addEventListener("abort", cleanup, { once: true });
    await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: clientName, version: "1.0.0" },
    });
    return await fn(connection);
  } finally {
    timeout.removeEventListener("abort", cleanup);
    cleanup();
  }
}

async function resolveAcpUrl(k8s: K8sClient, instanceName: string): Promise<string> {
  const cm = await k8s.getConfigMap(instanceName);
  const podIP = cm?.metadata?.annotations?.["humr.ai/pod-ip"];
  if (!podIP) throw new Error(`No active pod for instance ${instanceName}`);
  return `ws://${podIP}:8080/api/acp`;
}

export function createAcpClient(opts: {
  k8s: K8sClient;
  instanceName: string;
  onSessionCreated: (sessionId: string) => Promise<void>;
}): AcpClient {

  return {
    async listSessions(): Promise<AcpSessionInfo[]> {
      let stream: Stream;
      let ws: WebSocket;
      try {
        const url = await resolveAcpUrl(opts.k8s, opts.instanceName);
        ({ stream, ws } = await wsStream(url));
      } catch {
        return [];
      }

      const connection = new ClientSideConnection(
        () => ({
          async requestPermission() { return { outcome: { outcome: "selected" as const, optionId: "" } }; },
          async sessionUpdate() {},
          async writeTextFile() { return {}; },
          async readTextFile() { return { content: "" }; },
        }),
        stream,
      );

      try {
        await connection.initialize({
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "humr-sessions", version: "1.0.0" },
        });
        const r = await connection.listSessions({ cwd: "." });
        return (r.sessions ?? []) as AcpSessionInfo[];
      } catch {
        return [];
      } finally {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
    },

    async sendPrompt(prompt: string): Promise<string> {
      const url = await resolveAcpUrl(opts.k8s, opts.instanceName);
      const responseChunks: string[] = [];

      await withAcpConnection(url, "humr-acp", {
        async sessionUpdate(params: any) {
          if (params.update?.sessionUpdate === "agent_message_chunk" && params.update.content?.type === "text") {
            responseChunks.push(params.update.content.text);
          }
        },
      }, async (connection) => {
        const { sessionId } = await connection.newSession({ cwd: ".", mcpServers: [] });
        await opts.onSessionCreated(sessionId);
        await connection.prompt({ sessionId, prompt: [{ type: "text", text: prompt }] });
      });

      return responseChunks.join("");
    },

    async triggerSession(triggerOpts: {
      prompt: string;
      resumeSessionId?: string;
      mcpServers?: unknown[];
    }): Promise<TriggerSessionResult> {
      const url = await resolveAcpUrl(opts.k8s, opts.instanceName);
      return withAcpConnection(url, "humr-trigger", {}, async (connection) => {
        let sessionId: string;
        const mcpServers = (triggerOpts.mcpServers ?? []) as any[];

        if (triggerOpts.resumeSessionId) {
          await connection.unstable_resumeSession({
            sessionId: triggerOpts.resumeSessionId,
            cwd: ".",
            mcpServers,
          });
          sessionId = triggerOpts.resumeSessionId;
        } else {
          const s = await connection.newSession({ cwd: ".", mcpServers });
          sessionId = s.sessionId;
          await opts.onSessionCreated(sessionId);
        }

        const r = await connection.prompt({
          sessionId,
          prompt: [{ type: "text", text: triggerOpts.prompt }],
        });

        return { sessionId, stopReason: r.stopReason };
      });
    },
  };
}
