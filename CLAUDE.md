## Project Overview

ACP-over-HTTP adapter that wraps a local Claude Code agent and exposes it via HTTP to a React UI.

### Architecture

Three layers:
1. **HTTP Server** (`src/index.ts`, port 3000) — bridges HTTP to ACP protocol
2. **Agent Process** (`src/agent.ts`) — spawned as child process per request, runs `@agentclientprotocol/claude-agent-acp`
3. **React UI** (`ui/`) — chat interface consuming SSE stream, proxied via Vite (port 5173)

### Request Flow

```
UI POST /api/prompt → HTTP server spawns agent.ts child process
  → establishes ACP ClientSideConnection over stdio
  → initialize() → newSession() → prompt()
  → filters ACP events to SSE: agent_message_chunk → text, tool_call → tool chip
  → kills agent process on done/error
```

### Key Endpoints

- `POST /api/prompt` — accepts `{ prompt }`, returns SSE stream
- `POST /` — raw NDJSON passthrough for direct ACP testing (`src/test-client.ts`)

### Protocol

- ACP via `@agentclientprotocol/sdk` + `@agentclientprotocol/claude-agent-acp`
- NDJSON serialization over stdio between server and agent
- Permissions auto-approved; MCP servers: none; file callbacks: stubbed

## Testing

Always use `npm run start` to test.
