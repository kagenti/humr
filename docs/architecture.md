# Architecture

Humr — wraps a local Claude Code agent and exposes it via WebSocket + tRPC to a React UI.

## Monorepo Structure

pnpm workspaces with five packages:
- `packages/harness-runtime/` — HTTP/WebSocket server + agent process
- `packages/harness-runtime-api/` — shared tRPC router and type definitions
- `packages/ui/` — React chat interface (Vite, port 5173)
- `packages/humr-base/` — Docker base image (Node 22 slim + Claude Code CLI + bundled runtime)
- `packages/example-agent/` — example agent extending humr-base

## Layers

Three layers:
1. **HTTP/WS Server** (port 3000) — tRPC endpoints over HTTP, WebSocket bridge for Humr protocol
2. **Agent Process** — spawned as child process per WebSocket connection, runs `@agentclientprotocol/claude-agent-acp`, communicates via NDJSON over stdio. Dual-mode spawn: `npx tsx` in dev (`.ts`), `node` in prod (`.js`)
3. **React UI** — chat interface + file browser, Vite dev server proxies `/api` to port 3000

Agent operates in sandboxed `packages/harness-runtime/working-dir/` to avoid modifying prototype code.

## Communication

- **Humr protocol** flows over WebSocket (`/api/humr`): UI opens WS connection, server spawns agent child process, bridges JSON-RPC messages between WS and agent's stdio
- **tRPC** over HTTP (`/api/trpc/*`) for everything else: auth, config, file operations
- Agent process killed when WebSocket closes

## Session Persistence

- First prompt creates a new session via `newSession()`
- Subsequent prompts resume via `unstable_resumeSession({ sessionId })`
- UI stores `sessionId` in React state, can list past sessions

## Authentication

- UI checks auth status on mount via tRPC (`auth.status`, spawns `claude auth status` CLI)
- Login uses PKCE OAuth: server generates authorize URL, UI opens it, user pastes code back, server exchanges for tokens
- Credentials saved to `~/.claude/.credentials.json`
- On error `-32000`: UI shows login banner

## Protocol

- ACP via `@agentclientprotocol/sdk` + `@agentclientprotocol/claude-agent-acp`
- NDJSON serialization over stdio between server and agent
- Permissions auto-approved; MCP servers: none; file callbacks: stubbed

## Build

tsup bundles `harness-runtime` into `dist/index.js` + `dist/agent.js`, inlining `harness-runtime-api`. Run: `pnpm --filter harness-runtime build`.

## Docker

`humr-base` is the base Docker image (Node 22 slim + Claude Code CLI + bundled dist). `example-agent` extends it by copying `workspace/` into `/app/working-dir/`.
