# ADK Platform Implementation — Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each sub-plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full ADK platform — Helm chart, Go controller, TypeScript API server, agent runtime, and React UI — deployable to k3s via a single `helm install`.

**Architecture:** Six components communicating through K8s resources (ConfigMaps, Secrets). Controller (Go) reconciles desired state into StatefulSets, Services, NetworkPolicies. API Server (TypeScript) provides REST + WebSocket ACP relay. Agent Runtime (TypeScript) runs inside agent pods, evolving the existing agent-runtime. OneCLI Gateway (deployed as-is) handles credential injection via MITM proxy. React UI for instance management and chat.

**Tech Stack:** Go (controller), TypeScript/Node.js (API server, agent runtime), React 18 + Vite (UI), Helm 3 (deployment), k3s (target cluster), OneCLI (credential proxy), PostgreSQL (OneCLI dependency)

**Spec:** [`docs/specs/2026-04-01-agent-platform-design.md`](../specs/2026-04-01-agent-platform-design.md)

---

## Sub-Plans (dependency order)

Each sub-plan is independently implementable and testable. Execute in order — each builds on the previous.

### 1. Helm Chart & Infrastructure

**Plan:** [`2026-04-02-adk-01-helm-chart.md`](./2026-04-02-adk-01-helm-chart.md)

**Delivers:** A Helm chart that deploys OneCLI (gateway + web + PostgreSQL), generates CA certs, creates the `adk-agents` namespace, RBAC for Controller and API Server, and a default agent template ConfigMap.

**Done when:** `helm install adk deploy/helm/adk` succeeds on k3s. OneCLI gateway is reachable. PostgreSQL is running. CA cert Secret exists. `kubectl get cm -l humr.ai/type=agent-template` returns the default template.

**Files:**
- Create: `deploy/helm/adk/Chart.yaml`
- Create: `deploy/helm/adk/values.yaml`
- Create: `deploy/helm/adk/templates/_helpers.tpl`
- Create: `deploy/helm/adk/templates/namespace.yaml`
- Create: `deploy/helm/adk/templates/onecli-postgres.yaml`
- Create: `deploy/helm/adk/templates/onecli-gateway.yaml`
- Create: `deploy/helm/adk/templates/onecli-web.yaml`
- Create: `deploy/helm/adk/templates/ca-secret.yaml`
- Create: `deploy/helm/adk/templates/rbac-controller.yaml`
- Create: `deploy/helm/adk/templates/rbac-apiserver.yaml`
- Create: `deploy/helm/adk/templates/default-template.yaml`

---

### 2. Agent Runtime

**Plan:** `2026-04-02-adk-02-agent-runtime.md` (to be written)

**Delivers:** Evolution of `packages/agent-runtime/` into `packages/agent-runtime/`. WebSocket ACP server on port 8080, `/healthz` endpoint, trigger file watcher for scheduled execution, Dockerfile.

**Done when:** Docker image builds. Pod starts in k3s, readiness probe passes. Can connect via WebSocket, create a session, send a prompt, get a streaming response. Trigger file in `/workspace/.triggers/` creates a new session.

**Contract (what other components depend on):**
- Listens on port 8080, speaks ACP over WebSocket
- `GET /healthz` returns 200 when ready
- Watches `/workspace/.triggers/*.json` for schedule triggers, creates session per file, deletes file after pickup
- Expects env vars: `HTTPS_PROXY`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `ADK_INSTANCE_ID`
- Expects PVC mounts: `/workspace`, `/home/agent`

**Files:**
- Create: `packages/agent-runtime/package.json`
- Create: `packages/agent-runtime/tsconfig.json`
- Create: `packages/agent-runtime/src/server.ts` — WebSocket server + `/healthz`
- Create: `packages/agent-runtime/src/acp-bridge.ts` — ACP stdio bridge (evolved from agent-runtime)
- Create: `packages/agent-runtime/src/trigger-watcher.ts` — `/workspace/.triggers/` directory watcher
- Create: `packages/agent-runtime/Dockerfile`
- Modify: `package.json` (root) — add workspace entry + scripts
- Modify: `pnpm-workspace.yaml` — add agent-runtime

---

### 3. Go Controller

**Plan:** `2026-04-02-adk-03-controller.md` (to be written)

**Delivers:** Go binary that watches ConfigMaps (`agent-instance`, `agent-template`, `agent-schedule`), reconciles StatefulSets + headless Services + NetworkPolicies, runs in-process cron scheduler, provisions OneCLI agent tokens, delivers schedule triggers via pod exec.

**Done when:** Controller runs in k3s. Creating an instance ConfigMap causes a StatefulSet + Service + NetworkPolicy to appear. Deleting the ConfigMap cleans up. Changing `desiredState` toggles replicas. Schedule cron fires and writes trigger file into running pod.

**Contract (what other components depend on):**
- Watches ConfigMaps with `humr.ai/type` labels in configured namespace
- Writes `status.yaml` key in instance/schedule ConfigMaps
- Creates: StatefulSet `{instance}`, headless Service `{instance}`, NetworkPolicy `{instance}-egress`
- StatefulSet uses image + config from referenced template ConfigMap
- Mounts CA cert, sets `HTTPS_PROXY` + `SSL_CERT_FILE` + `NODE_EXTRA_CA_CERTS` env vars
- Creates OneCLI agent token on instance creation, stores in Secret
- Exec-based trigger delivery to `/workspace/.triggers/{timestamp}.json`

**Files:**
- Create: `packages/controller/go.mod`
- Create: `packages/controller/go.sum`
- Create: `packages/controller/main.go` — entrypoint, leader election, informer setup
- Create: `packages/controller/pkg/reconciler/instance.go` — instance ConfigMap → StatefulSet + Service + NetworkPolicy
- Create: `packages/controller/pkg/reconciler/template.go` — template ConfigMap parsing
- Create: `packages/controller/pkg/scheduler/scheduler.go` — in-process cron, trigger delivery via exec
- Create: `packages/controller/pkg/onecli/client.go` — OneCLI REST API client (agent CRUD, policy rules)
- Create: `packages/controller/pkg/config/config.go` — env-based configuration
- Create: `packages/controller/Dockerfile`
- Modify: `deploy/helm/adk/templates/controller.yaml` — Deployment for controller
- Modify: `deploy/helm/adk/values.yaml` — controller image + config

---

### 4. API Server

**Plan:** `2026-04-02-adk-04-api-server.md` (to be written)

**Delivers:** TypeScript HTTP server with REST API for instance/template/schedule CRUD, WebSocket ACP relay to agent pods, static UI serving, K8s client for ConfigMap/Secret/Pod operations.

**Done when:** API Server runs in k3s. REST API creates/lists/deletes instances. WebSocket ACP relay connects to agent pod, chat works end-to-end. `humr.ai/last-activity` annotation updates on message relay.

**Contract (what other components depend on):**
- `GET/POST /api/v1/instances` — list/create instances
- `GET/PATCH/DELETE /api/v1/instances/:id` — get/update/delete instance
- `POST /api/v1/instances/:id/wake` — patch desiredState: running
- `POST /api/v1/instances/:id/hibernate` — patch desiredState: hibernated
- `GET /api/v1/instances/:id/status` — instance status + pod readiness
- `GET/POST/PATCH/DELETE /api/v1/templates` — template CRUD
- `GET/POST/PATCH/DELETE /api/v1/instances/:id/schedules` — schedule CRUD
- `WS /api/v1/instances/:id/acp` — bidirectional ACP relay to agent pod
- Serves static files from UI build directory
- Updates `humr.ai/last-activity` and `humr.ai/active-session` annotations

**Files:**
- Create: `packages/api-server/package.json`
- Create: `packages/api-server/tsconfig.json`
- Create: `packages/api-server/src/index.ts` — HTTP server entrypoint
- Create: `packages/api-server/src/routes/instances.ts` — instance CRUD routes
- Create: `packages/api-server/src/routes/templates.ts` — template CRUD routes
- Create: `packages/api-server/src/routes/schedules.ts` — schedule CRUD routes
- Create: `packages/api-server/src/acp-relay.ts` — WebSocket ACP relay (UI ↔ agent pod)
- Create: `packages/api-server/src/k8s.ts` — K8s client (ConfigMaps, Secrets, Pods)
- Create: `packages/api-server/Dockerfile`
- Modify: `deploy/helm/adk/templates/api-server.yaml` — Deployment + Service
- Modify: `deploy/helm/adk/values.yaml` — api-server image + config
- Modify: `package.json` (root) — add workspace entry + scripts
- Modify: `pnpm-workspace.yaml` — add api-server

---

### 5. Web UI

**Plan:** `2026-04-02-adk-05-web-ui.md` (to be written)

**Delivers:** Expanded React UI with instance management (list, create, delete, wake, hibernate), chat via API Server WebSocket relay, session management, file browser, schedule CRUD.

**Done when:** UI served by API Server. Can create an instance from a template, wait for it to become ready, open chat, send messages, browse files, list/resume sessions, create/edit schedules.

**Contract (what this depends on):**
- API Server REST endpoints for CRUD
- API Server WebSocket at `/api/v1/instances/:id/acp` for chat
- Served as static build by API Server

**Files:**
- Modify: `packages/ui/src/App.tsx` — route between instance list and instance detail views
- Create: `packages/ui/src/views/InstanceList.tsx` — list instances, create from template, status indicators
- Create: `packages/ui/src/views/InstanceDetail.tsx` — chat + sidebar (sessions, files, schedules)
- Create: `packages/ui/src/components/Chat.tsx` — extracted from current App.tsx, adapted for API Server WS
- Create: `packages/ui/src/components/SessionList.tsx` — session list/load/new
- Create: `packages/ui/src/components/FileBrowser.tsx` — file tree + viewer (extracted from current App.tsx)
- Create: `packages/ui/src/components/ScheduleEditor.tsx` — schedule CRUD form
- Create: `packages/ui/src/components/InstanceForm.tsx` — create instance from template
- Create: `packages/ui/src/api.ts` — REST API client for API Server
- Modify: `packages/ui/src/App.css` — styles for new views
- Modify: `packages/ui/vite.config.ts` — proxy to API Server in dev mode
