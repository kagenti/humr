# Humr

```
 ╦ ╦╦ ╦╔╦╗╔═╗
 ╠═╣║ ║║║║╠╦╝
 ╩ ╩╚═╝╩ ╩╩╚═

 Run AI harnesses in production.
 Isolated. Credentialed. Scheduled.
```

Kubernetes platform for running AI agent harnesses (Claude Code, Codex, Gemini CLI) in isolated environments with credential injection, network isolation, and scheduled execution.

## Quick Start

```sh
mise run setup              # install deps, configure git hooks
mise run cluster:install    # create local k3s cluster + deploy Humr
mise run cluster:status     # check pods
eval "$(mise run humr:shell)" # activate cluster env
```

Open **`humr.localhost:4444`** in your browser, create an instance from a template, and start chatting.

## Development

```sh
mise run check              # lint + type-check
mise run test               # run tests
mise run ui:run             # start UI dev server
mise run cluster:upgrade    # redeploy after changes
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for full details.

- **Controller** (Go) — K8s reconciler + cron scheduler
- **API Server** (TypeScript) — REST API + ACP WebSocket relay + serves UI
- **Agent Runtime** (TypeScript) — ACP server inside each agent pod
- **OneCLI** — credential injection proxy, network policy enforcement
- **Web UI** (React) — instance management, chat, scheduling
