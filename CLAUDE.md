## Project Overview

ACP adapter that wraps a local Claude Code agent and exposes it via WebSocket + tRPC to a React UI.

### Monorepo Structure

pnpm workspaces with three packages:
- `packages/harness-runtime/` — HTTP/WebSocket server + ACP agent process
- `packages/harness-runtime-api/` — shared tRPC router and type definitions
- `packages/ui/` — React chat interface (Vite, port 5173)

### Architecture

Three layers:
1. **HTTP/WS Server** (port 3000) — tRPC endpoints over HTTP, WebSocket bridge for ACP protocol
2. **Agent Process** — spawned as child process per WebSocket connection, runs `@agentclientprotocol/claude-agent-acp`, communicates via NDJSON over stdio
3. **React UI** — chat interface + file browser, Vite dev server proxies `/api` to port 3000

Agent operates in sandboxed `packages/harness-runtime/working-dir/` to avoid modifying prototype code.

### Communication

- **ACP protocol** flows over WebSocket (`/api/acp`): UI opens WS connection, server spawns agent child process, bridges JSON-RPC messages between WS and agent's stdio
- **tRPC** over HTTP (`/api/trpc/*`) for everything else: auth, config, file operations
- Agent process killed when WebSocket closes

### Session Persistence

- First prompt creates a new ACP session via `newSession()`
- Subsequent prompts resume via `unstable_resumeSession({ sessionId })`
- UI stores `sessionId` in React state, can list past sessions

### Authentication

- UI checks auth status on mount via tRPC (`auth.status`, spawns `claude auth status` CLI)
- Login uses PKCE OAuth: server generates authorize URL, UI opens it, user pastes code back, server exchanges for tokens
- Credentials saved to `~/.claude/.credentials.json`
- On ACP error `-32000`: UI shows login banner

### Protocol

- ACP via `@agentclientprotocol/sdk` + `@agentclientprotocol/claude-agent-acp`
- NDJSON serialization over stdio between server and agent
- Permissions auto-approved; MCP servers: none; file callbacks: stubbed

## Testing

Always use `pnpm start` to test (runs harness-runtime). UI: `pnpm ui`.
