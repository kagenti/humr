## Project Overview

Humr — a Kubernetes platform for running AI agent harnesses (Claude Code, Codex, Gemini CLI) in isolated environments with credential injection, network isolation, and scheduled execution.

Always check [docs/architecture.md](docs/architecture.md) for full architecture details.

### Monorepo Structure

pnpm workspaces + standalone Go module:
- `packages/harness-runtime/` — HTTP server bridging to ACP agent process
- `packages/harness-runtime-api/` — API layer for harness-runtime
- `packages/humr-base/` — shared base image/utilities
- `packages/example-agent/` — example agent configuration
- `packages/controller/` — Go K8s reconciler + scheduler
- `packages/ui/` — React chat interface (Vite)
- `deploy/helm/humr/` — Helm chart for all components + OneCLI + PostgreSQL

Together, `harness-runtime` + `harness-runtime-api` form the agent runtime — the ACP WebSocket server that runs inside each agent pod.

## Workflow

mise is the task runner. All tasks are defined in `tasks.toml` files.

```sh
mise run check              # lint + type-check all packages (also runs as pre-commit hook)
mise run test               # run all tests
mise run helm:check:lint    # helm lint
mise run helm:check:render  # helm template | kubeconform
mise run ui:run             # start UI dev server
```

### Cluster lifecycle (k3s via lima)

```sh
mise run cluster:install    # create k3s VM, install cert-manager + ADK chart
mise run cluster:upgrade    # helm upgrade with latest chart changes
mise run cluster:status     # show pods and cluster state
mise run cluster:logs       # show OneCLI pod logs
mise run cluster:uninstall  # helm uninstall (keeps PVCs)
mise run cluster:delete     # destroy k3s VM entirely
```

Activate cluster environment: `eval $(mise run humr:shell)` (sets KUBECONFIG, adds prompt prefix, `deactivate` to undo).

## Architecture

Three-tier K8s platform:
1. **Controller** (Go) — watches ConfigMaps, reconciles StatefulSets/Services/NetworkPolicies, runs cron scheduler
2. **API Server** (TypeScript) — REST CRUD for instances/templates/schedules, WebSocket ACP relay to agent pods
3. **Agent Runtime** (TypeScript, `harness-runtime` + `harness-runtime-api`) — ACP WebSocket server inside agent pods

Infrastructure:
- **OneCLI** — credential injection proxy (MITM), single container with Rust gateway + Node.js web dashboard
- **cert-manager** — generates self-signed ECDSA CA (PKCS8) for OneCLI MITM TLS
- **PostgreSQL** — OneCLI's internal dependency

K8s resource model: ConfigMaps with `humr.ai/type` labels (agent-template, agent-instance, agent-schedule). Each ConfigMap uses `spec.yaml` (API Server writes) and `status.yaml` (Controller writes) keys to avoid write contention. Not CRDs — deployable without cluster-admin.

## Key Design Decisions

- OneCLI ships as a single Docker image running both gateway + web via entrypoint.sh — deployed as one pod, two Services
- Scheduling: Controller owns cron + delivers triggers via `kubectl exec` writing files to `/workspace/.triggers/`
- Concurrent sessions always allowed (no concurrency gating)

## Specs and Plans

- Design spec: `docs/specs/2026-04-01-agent-platform-design.md`
- Master plan: `docs/plans/2026-04-02-adk-platform-master.md`
