import http from "node:http";
import { spawn } from "node:child_process";
import { Writable, Readable, PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as acp from "@agentclientprotocol/sdk/dist/acp.js";

const PORT = Number(process.env.PORT ?? 3000);
const agentScript = join(dirname(fileURLToPath(import.meta.url)), "agent.ts");
const WORKING_DIR = join(dirname(fileURLToPath(import.meta.url)), "../working-dir");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function connectToAgent(cwd: string, onUpdate: (u: any) => void) {
  const agent = spawn("npx", ["tsx", agentScript], { stdio: ["pipe", "pipe", "inherit"], cwd });
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  agent.stdout.pipe(fromAgent);
  toAgent.pipe(agent.stdin);
  const stream = acp.ndJsonStream(
    Writable.toWeb(toAgent),
    Readable.toWeb(fromAgent) as ReadableStream<Uint8Array>,
  );
  const connection = new acp.ClientSideConnection(
    (_) => ({
      async requestPermission(params: any) {
        return { outcome: { outcome: "selected" as const, optionId: params.options[0].optionId } };
      },
      async sessionUpdate(params: any) { onUpdate(params.update); },
      async writeTextFile() { return {}; },
      async readTextFile() { return { content: "" }; },
    }),
    stream,
  );
  return { agent, connection };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/prompt") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const { prompt, sessionId } = JSON.parse(body);
      res.writeHead(200, { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

      const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const { agent, connection } = connectToAgent(WORKING_DIR, (u) => {
        if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
          send({ type: "text", text: u.content.text });
        } else if (u.sessionUpdate === "tool_call") {
          send({ type: "tool", title: u.title, status: u.status });
        }
      });

      try {
        await connection.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        });
        let activeSessionId: string;
        if (sessionId) {
          await connection.unstable_resumeSession({ sessionId, cwd: WORKING_DIR, mcpServers: [] });
          activeSessionId = sessionId;
        } else {
          const session = await connection.newSession({ cwd: WORKING_DIR, mcpServers: [] });
          activeSessionId = session.sessionId;
          send({ type: "session", sessionId: activeSessionId });
        }
        const result = await connection.prompt({
          sessionId: activeSessionId,
          prompt: [{ type: "text", text: prompt }],
        });
        send({ type: "done", stopReason: result.stopReason });
      } catch (err: any) {
        send({ type: "error", message: err.message });
      } finally {
        res.end();
        agent.kill();
      }
    });
    return;
  }

  if (req.method === "POST") {
    const agent = spawn("npx", ["tsx", agentScript], { stdio: ["pipe", "pipe", "inherit"] });
    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked" });
    req.pipe(agent.stdin);
    agent.stdout.pipe(res);
    req.on("close", () => agent.kill());
    return;
  }

  res.writeHead(405).end();
});

server.listen(PORT, () => process.stderr.write(`ACP over HTTP on http://localhost:${PORT}\n`));
