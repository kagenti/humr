## Project Overview

ACP-over-HTTP adapter that wraps a local Claude Code agent and exposes it via HTTP to a React UI.

### Architecture

Three layers:
1. **HTTP Server** (`src/index.ts`, port 3000) — bridges HTTP to ACP protocol
2. **Agent Process** (`src/agent.ts`) — spawned as child process per request, runs `@agentclientprotocol/claude-agent-acp`
3. **React UI** (`ui/`) — chat interface consuming SSE stream, proxied via Vite (port 5173)

Agent operates in sandboxed `working-dir/` to avoid modifying prototype code.

### Request Flow

```
UI POST /api/prompt → HTTP server spawns agent.ts child process
  → establishes ACP ClientSideConnection over stdio
  → initialize() → newSession() or resumeSession() → prompt()
  → filters ACP events to SSE: agent_message_chunk → text, tool_call → tool chip
  → kills agent process on done/error
  → on ACP error -32000: sends auth_required event instead
```

### Session Persistence

- First prompt creates a new ACP session, server returns `{ type: "session", sessionId }` via SSE
- Subsequent prompts include `sessionId` to resume the existing session
- UI stores `sessionId` in React state

### Authentication

- On mount, UI checks `GET /api/auth/status` (spawns `claude auth status` CLI)
- If unauthenticated, UI shows login banner
- `POST /api/auth/login` streams OAuth flow via SSE, extracts login URL
- After successful login, pending prompt is auto-retried

### Key Endpoints

- `POST /api/prompt` — accepts `{ prompt, sessionId? }`, returns SSE stream
- `GET /api/auth/status` — returns `{ authenticated, loggedIn }`
- `POST /api/auth/login` — SSE stream of OAuth login flow

### SSE Event Types

Prompt stream: `text`, `tool`, `done`, `error`, `session`, `auth_required`
Login stream: `login_output`, `login_url`, `login_done`, `login_error`

### Protocol

- ACP via `@agentclientprotocol/sdk` + `@agentclientprotocol/claude-agent-acp`
- NDJSON serialization over stdio between server and agent
- Permissions auto-approved; MCP servers: none; file callbacks: stubbed

## Testing

Always use `npm run start` to test.
