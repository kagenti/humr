import { Writable, Readable, PassThrough } from "node:stream";
import http from "node:http";
import * as acp from "@agentclientprotocol/sdk/dist/acp.js";

const HOST = process.env.ACP_HOST ?? "localhost";
const PORT = Number(process.env.ACP_PORT ?? 3000);

const toServer = new PassThrough();
const fromServer = new PassThrough();

const req = http.request({ host: HOST, port: PORT, method: "POST", path: "/", headers: { "Content-Type": "application/x-ndjson" } }, (res) => {
  res.pipe(fromServer);
});
toServer.pipe(req);

const input = Writable.toWeb(toServer);
const output = Readable.toWeb(fromServer) as ReadableStream<Uint8Array>;
const stream = acp.ndJsonStream(input, output);

const connection = new acp.ClientSideConnection(
  (_agent) => ({
    async requestPermission(params: any) {
      console.error(`Permission: ${params.toolCall.title}`);
      return { outcome: { outcome: "selected", optionId: params.options[0].optionId } };
    },
    async sessionUpdate(params: any) {
      const u = params.update;
      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
        process.stdout.write(u.content.text);
      } else if (u.sessionUpdate === "tool_call") {
        console.error(`\n[tool] ${u.title} (${u.status})`);
      }
    },
    async writeTextFile() { return {}; },
    async readTextFile() { return { content: "" }; },
  }),
  stream,
);

const init = await connection.initialize({
  protocolVersion: acp.PROTOCOL_VERSION,
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
});
console.error(`Connected (protocol v${init.protocolVersion})`);

const session = await connection.newSession({ cwd: process.cwd(), mcpServers: [] });
console.error(`Session: ${session.sessionId}\n`);

const prompt = process.argv[2] ?? "Say hello in one sentence.";
console.error(`User: ${prompt}\n`);

const result = await connection.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: "text", text: prompt }],
});

console.error(`\nDone: ${result.stopReason}`);
req.destroy();
process.exit(0);
