import {
  ClientSideConnection,
} from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type { AnyMessage } from "@agentclientprotocol/sdk/dist/jsonrpc.js";
import { getAccessToken } from "./auth.js";

export type UpdateHandler = (update: any) => void;

const WS_CONNECT_TIMEOUT_MS = 120_000;

function wsStream(url: string): Promise<{ stream: Stream; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error("WebSocket connect timeout")); }, WS_CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      const readable = new ReadableStream<AnyMessage>({
        start(controller) {
          ws.onmessage = (e) => controller.enqueue(JSON.parse(e.data));
          ws.onclose = () => {
            try {
              controller.close();
            } catch {}
          };
          ws.onerror = (err) => {
            try {
              controller.error(err);
            } catch {}
          };
        },
      });
      const writable = new WritableStream<AnyMessage>({
        write(chunk) {
          ws.send(JSON.stringify(chunk));
        },
        close() {
          ws.close();
        },
      });
      resolve({ stream: { readable, writable }, ws });
    };
    ws.onerror = reject;
  });
}

async function wsUrl(instanceId: string): Promise<string> {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const token = await getAccessToken();
  return `${proto}//${location.host}/api/instances/${instanceId}/acp?token=${encodeURIComponent(token)}`;
}

export async function openConnection(
  instanceId: string,
  onUpdate: UpdateHandler,
): Promise<{ connection: ClientSideConnection; ws: WebSocket }> {
  const { stream, ws } = await wsStream(await wsUrl(instanceId));
  const connection = new ClientSideConnection(
    () => ({
      async requestPermission(params: any) {
        const opts: Array<{ kind?: string; optionId: string }> = params.options ?? [];
        const pick =
          opts.find((o) => o.kind === "allow_always") ??
          opts.find((o) => o.kind === "allow_once") ??
          opts[0];
        return {
          outcome: {
            outcome: "selected" as const,
            optionId: pick.optionId,
          },
        };
      },
      async sessionUpdate(params: any) {
        onUpdate(params.update);
      },
      async writeTextFile() {
        return {};
      },
      async readTextFile() {
        return { content: "" };
      },
    }),
    stream,
  );
  return { connection, ws };
}
