## Harness HTTP API

- **ACP protocol** flows over WebSocket (`/api/acp`): UI opens WS connection, server spawns agent child process, bridges JSON-RPC messages between WS and agent's stdio
- WS bridge rewrites `params.cwd` in every incoming JSON-RPC message to the server's `WORKING_DIR`, ignoring whatever the client sends
- **tRPC** over HTTP (`/api/trpc/*`) for everything else: auth, config, file operations
- Agent process killed when WebSocket closes