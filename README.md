# Humr

Wraps a local Claude Code agent and exposes it via WebSocket + tRPC to a React UI.

## Prerequisites

- Node.js (v20+)
- pnpm (v9+)
- Claude Code CLI installed and available on `PATH`

## Setup

```bash
pnpm install
```

## Running

Start both the runtime server and the UI in separate terminals:

```bash
# Terminal 1 — harness runtime (port 3000)
pnpm start

# Terminal 2 — React UI (port 5173)
pnpm ui
```

For development with auto-reload on the runtime:

```bash
pnpm dev
```

Open http://localhost:5173 in your browser.

## Docker

Build and run the base image:

```bash
pnpm docker:humr-base:build
pnpm docker:humr-base:start
```

Build and run the example agent (extends humr-base, copies `workspace/` into the container):

```bash
pnpm docker:example-agent:build
pnpm docker:example-agent:start
```
