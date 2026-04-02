# Architecture

## Monorepo Structure

pnpm workspaces with five packages:
- `packages/harness-runtime/` — HTTP/WebSocket server + agent process
- `packages/harness-runtime-api/` — shared tRPC router and type definitions
- `packages/ui/` — React chat interface (Vite, port 5173)
- `packages/humr-base/` — Docker base image (Node 22 slim + Claude Code CLI + bundled runtime)
- `packages/example-agent/` — example agent extending humr-base

## Agents are ACP-compliant

- ACP via `@agentclientprotocol/sdk` + `@agentclientprotocol/claude-agent-acp`
- NDJSON serialization over stdio between server and agent
- Permissions auto-approved; MCP servers: none; file callbacks: stubbed

## Complete documentation

- [Whole System Layers](./layers.md)
- [ACP Session Persistence](./session-persistence.md)
- [Claude Code Authentication](./authentication.md)
- [Docker setup for building agents](./docker.md)
- [Harness HTTP API](./harness-runtime/api.md)