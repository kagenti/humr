## Harness HTTP API

- **Humr protocol** flows over WebSocket (`/api/humr`): UI opens WS connection, server spawns agent child process, bridges JSON-RPC messages between WS and agent's stdio
- **tRPC** over HTTP (`/api/trpc/*`) for everything else: auth, config, file operations
- Agent process killed when WebSocket closes