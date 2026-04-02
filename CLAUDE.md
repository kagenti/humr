## Project Overview

Humr — wraps a local Claude Code agent and exposes it via WebSocket + tRPC to a React UI.

Always check [docs/architecture.md](docs/architecture/index.md) for full architecture details.

## Workflow

1. `pnpm typecheck` — run before committing, must pass
2. `pnpm start` — test harness-runtime
3. `pnpm ui` — test UI
