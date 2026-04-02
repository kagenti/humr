## Layers

Three layers:
1. **HTTP/WS Server** (port 3000) — tRPC endpoints over HTTP, WebSocket bridge for Humr protocol
2. **Agent Process** — spawned as child process per WebSocket connection, runs `@agentclientprotocol/claude-agent-acp`, communicates via NDJSON over stdio. Dual-mode spawn: `npx tsx` in dev (`.ts`), `node` in prod (`.js`)
3. **React UI** — chat interface + file browser, Vite dev server proxies `/api` to port 3000

Agent operates in sandboxed `packages/harness-runtime/working-dir/` to avoid modifying prototype code.
