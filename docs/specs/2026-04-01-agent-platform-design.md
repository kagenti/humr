# ADK: Secure Agent Execution Platform

**Date:** 2026-04-01
**Status:** Draft
**Issue:** [technical-strategy#73](https://github.ibm.com/Incubation/technical-strategy/issues/73)

## Summary

A platform for running AI code harnesses (Claude Code, Codex, Gemini CLI) in isolated Kubernetes environments with strict security boundaries, human-in-the-loop approval, and scheduled execution. The agent never sees real credentials. The platform is harness-agnostic, model-agnostic, and open-source.

## Principles

1. **The harness is the developer's choice.** We don't replace Claude Code, we make it production-ready.
2. **Security is structural, not behavioral.** Network isolation and credential injection are enforced by infrastructure, not by trusting the agent to follow rules.
3. **Default-deny.** An agent can reach nothing unless explicitly allowed.
4. **The agent never sees a token.** Credentials are injected transparently by the gateway.
5. **Prototype on k3s, design for OpenShift.** Single-node first, multi-tenant later.
6. **K8s is the database.** No external database. ConfigMaps, Secrets, and PVCs are the persistence layer. The controller is stateless. (Exception: OneCLI maintains its own PostgreSQL for internal state — see OneCLI Integration.)
7. **Separation of concerns.** The Controller reconciles cluster state. The API Server handles user-facing concerns. They communicate through K8s resources, not direct calls.

## Core Concepts

**Agent Template**: an OCI image + configuration. Defines the harness, mount paths, init script, env vars, resource limits. Stored as a ConfigMap with label `humr.ai/type: agent-template`.

**Agent Instance**: a running (or hibernated) copy of a template. Has its own PVC(s) that persist workspace, cached packages, and session history. Stored as a ConfigMap with label `humr.ai/type: agent-instance`, referencing a Secret for credentials.

**Session**: an ACP conversation inside an instance. The agent manages sessions (create, list, load, replay) on its PVC. The platform knows nothing about session internals. One instance holds multiple sessions.

The UI shows instances as "Agents" and templates as "Templates."

```
Template  = blueprint (image + config)
Instance  = running agent (StatefulSet + PVC + headless Service)
Session   = conversation inside an instance (agent-managed, on PVC)
```

## Architecture Overview

```
+----------------------------------------------------------+
|  Web UI (React + Vite SPA, served by API Server)         |
+----------------------------+-----------------------------+
                             |
+----------------------------v-----------------------------+
|  API Server (TypeScript / Node.js)                       |
|  - REST API for instance lifecycle                       |
|  - Connects to agent pods via ACP WebSocket (inbound)    |
|  - Relays ACP between UI and agent pods                  |
|  - Serves static React UI build                          |
|  - Reads/writes K8s resources (ConfigMaps, Secrets)      |
|  - No reconciliation, no scheduling                      |
+---+------------------------------------------+-----------+
    | K8s API (read/write ConfigMaps, Secrets)  | ACP WebSocket
    |                                           | (API Server → agent pod)
+---+------------------------------------------------------+
|  K8s Resources (shared state between components)         |
|                                                          |
|  ConfigMaps:  agent-template, agent-instance,            |
|               agent-schedule                             |
|  Secrets:     per-instance credentials                   |
|  StatefulSets, PVCs, headless Services, NetworkPolicies: |
|               created by Controller                      |
+---+------------------------------------------------------+
    | K8s API (watch + reconcile)
    |
+---v------------------------------------------------------+
|  Controller (Go, singleton with leader election)         |
|  - Watches ConfigMaps with humr.ai/type labels           |
|  - Reconciles: StatefulSet + PVC + Service + NetPolicy   |
|  - In-process scheduler (cron + heartbeat)               |
|  - OneCLI agent token provisioning                       |
|  - No user-facing API, no WebSocket                      |
+----------------------------------------------------------+

+----------------------------------------------------------+
|  Agent Pod (inside StatefulSet, per instance)            |
|  +-----------------------------------------------------+ |
|  | Harness container  | ACP server (listens on port,   | |
|  | (Claude Code, etc) | accepts WS from API Server)    | |
|  +--------+-----------+--------------------------------+ |
|           | HTTPS_PROXY                                   |
+-----------v----------------------------------------------+
            |
+-----------v----------------------------------------------+
|  OneCLI Gateway                                          |
|  - Credential injection (MITM)                           |
|  - Host/path policy enforcement                          |
|  - Audit log                                             |
+----------------------------------------------------------+
```

### Components

**1. Controller (Go, singleton pod with leader election)**

A stateless reconciler and scheduler. Has no user-facing API. Restartable at any time without data loss. Can crash/restart without affecting active WebSocket connections in the API Server. Runs with leader election so zero-downtime upgrades are possible (two replicas, only the leader reconciles).

- **Reconciliation loop:** Watches ConfigMaps with `humr.ai/type` labels via the K8s API. For each agent instance, ensures a StatefulSet + PVC(s) + headless Service + NetworkPolicy exist and match the desired state. On ConfigMap delete, cleans up all reconciled resources (except PVCs, which require explicit instance deletion).
- **Instance lifecycle:** Triggered by ConfigMap changes (written by the API Server). Reads `spec.yaml` from instance ConfigMap for desired state. Writes observed state back to `status.yaml` in the same ConfigMap (separate keys, no write contention — see Resource Model). Reconciles: replicas 0 (hibernated) or 1 (running). Hibernation preserves PVCs. Waking re-mounts PVCs and the agent resumes with full state.
- **In-process scheduler:** Runs cron and heartbeat schedules. Schedule configuration is stored in ConfigMaps (`humr.ai/type: agent-schedule`). The Controller reads `spec.yaml` for schedule config and writes `status.yaml` with `lastRun`/`nextRun`. On restart, it reads all schedule ConfigMaps and recomputes timers. For scheduled triggers, the Controller wakes the instance (if hibernated) and writes a trigger ConfigMap (`humr.ai/type: agent-trigger`) that the API Server watches and delivers to the agent pod.
- **OneCLI provisioning:** On instance creation, creates a per-instance OneCLI agent token via OneCLI REST API, with scoped credentials and policy rules. Stores the token in the instance's Secret.

Written in Go for first-class K8s API support (`client-go`), single-binary deployment, and a clean upgrade path to a K8s operator if the prototype succeeds.

**2. API Server (TypeScript / Node.js)**

The user-facing backend. Serves the React UI and provides REST + WebSocket APIs. Reads and writes K8s resources (ConfigMaps, Secrets) but does not reconcile — it writes desired state, the Controller reconciles actual state.

- **REST API:** CRUD for instances, templates, schedules. Each operation translates to a ConfigMap/Secret create/update/delete. The API Server does not create StatefulSets or PVCs directly — it writes `spec.yaml` in ConfigMaps, the Controller reconciles.
- **ACP relay (connects to agent pods):** When a user opens a chat, the API Server connects to the agent pod's ACP WebSocket endpoint via its stable DNS name (`{instance}-0.{instance}.{namespace}.svc`). The API Server relays ACP messages bidirectionally between the UI WebSocket and the agent pod WebSocket. No conversation history is stored; the agent stores sessions on its PVC.
- **Trigger delivery:** Watches for trigger ConfigMaps (`humr.ai/type: agent-trigger`) written by the Controller's scheduler. On detection, connects to the agent pod and delivers the scheduled prompt via ACP, then deletes the trigger ConfigMap.
- **Static UI serving:** Serves the Vite build output of the React SPA.
- **Session/file proxy:** Passes ACP `listSessions`, `loadSession`, `ReadTextFile`, `WriteTextFile` through to the agent pod.
- **Approval relay:** When an agent pod sends a permission request via ACP, the API Server relays it to the UI via WebSocket. The user approves or denies inline in the conversation.

Written in TypeScript to share the ecosystem with the React UI and leverage existing ACP SDK integration from the prototype.

**3. OneCLI Gateway**

An open-source HTTP/HTTPS proxy gateway ([onecli.sh](https://onecli.sh)). Used directly as a dependency. Missing features (default-deny, approval action) should be contributed upstream. If upstream is unresponsive, fork as a last resort.

How it works:
- Agent pod gets `HTTPS_PROXY` pointed at OneCLI gateway
- Agent makes normal HTTP calls (e.g. `gh pr create` hits `api.github.com`)
- OneCLI intercepts via MITM, matches the request to stored credentials, injects the real token
- Agent never sees the real credential, only a placeholder

OneCLI already supports:
- **GitHub:** `api.github.com` (Bearer), `github.com` (Basic/x-access-token for git HTTPS), `raw.githubusercontent.com` (Bearer)
- **Google services:** Gmail, Calendar, Drive (OAuth with token refresh)
- **Policy rules:** Block or rate-limit by host pattern, path pattern, HTTP method, scoped per agent
- **Dashboard UI:** Web interface for managing agents, secrets, connections, and policy rules
- **Vault integration:** Bitwarden and other password managers for credential sourcing
- **Audit logging:** All requests logged with agent identity

What OneCLI needs for this project (contribute upstream or extend):
- **Default-deny posture per agent:** Currently default-allow with block rules. We need the inverse: deny all hosts unless explicitly allowed for this agent token.
- **Approval action:** The dashboard UI already says "Monitor and Approval actions coming soon." This would hold a request, notify the API Server, wait for human approval, then release or reject. Enables "allow for this session" dynamic rules.
- **Host-level allowlists:** Current policy operates on path/method within a matched host. We need host-level gating: "this agent can only reach github.com and api.anthropic.com."

**4. Agent Pod (inside StatefulSet)**

A long-running pod (StatefulSet with replicas: 0 or 1) per instance. StatefulSet provides stable pod name (`{instance}-0`), stable DNS via headless Service, and built-in PVC lifecycle management via `volumeClaimTemplates`. Contains:

- **Harness container:** Claude Code (first target), or any other harness. Runs unmodified. Configured via environment variables and mounted files (CLAUDE.md, system prompt, rules).
- **ACP server:** Listens on a WebSocket port (default 8080). The API Server connects to this port when a user opens a chat or a scheduled trigger fires. The bridge translates between the WebSocket connection and the harness's ACP interface (stdio). This is a direct evolution of the current `harness-runtime` — same Node.js codebase, same "listen on a port" pattern, no code changes needed for the connection direction.
- **Readiness probe:** HTTP GET on the ACP port (e.g. `/healthz`). The pod is ready only when the ACP server is listening and the harness process is alive. This ensures the API Server (and scheduled triggers) don't attempt to connect before the agent is ready.
- **Liveness probe:** Same endpoint. If the harness process dies, the probe fails, kubelet restarts the container, PVCs remain mounted.
- **Persistent Volumes:** Managed by StatefulSet `volumeClaimTemplates`. Workspace PVC at `/workspace`, home PVC at `/home/agent`. Contain git repo clones, agent memory, sessions, venvs, and any state the harness writes. Survive pod restarts and hibernation. PVCs are not deleted when the StatefulSet scales to 0.
- **Environment:**
  - `HTTPS_PROXY` / `HTTP_PROXY` = OneCLI gateway address
  - `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` = OneCLI CA cert (for MITM TLS)
  - Placeholder tokens for services (e.g. `GH_TOKEN=placeholder`) that OneCLI swaps transparently
  - `ADK_INSTANCE_ID` = instance identifier (for logging and identification)

**5. NetworkPolicy (per instance)**

Each instance gets its own NetworkPolicy, created alongside the StatefulSet by the Controller. The policy enforces deny-all egress with three exceptions:
1. OneCLI gateway (for all external HTTP/HTTPS traffic)
2. DNS (for hostname resolution)

And allows ingress on the ACP port from the API Server only (so the API Server can connect to the agent pod's WebSocket).

Any direct connection to the internet is dropped at the network level. Even if the agent ignores `HTTPS_PROXY` or spawns a raw TCP socket, it cannot reach anything outside these three targets.

**6. Web UI (React + Vite)**

A single-page application served by the API Server. Built with React 18 and Vite. Communicates with the API Server via REST (lifecycle operations) and WebSocket (ACP chat relay).

Responsibilities:

- **Instance management:** Create instances from templates, configure, schedule, monitor, hibernate, wake, delete. Operations translate to REST calls to the API Server, which writes ConfigMaps. The Controller reconciles.
- **Chat:** Real-time conversation with the agent via ACP (through API Server WebSocket relay). Messages flow: UI WebSocket → API Server → agent pod WebSocket.
- **Session management:** List sessions within an instance, create new sessions, resume existing ones. All via ACP passthrough to the agent.
- **File browser:** Browse and edit the agent's workspace via ACP `ReadTextFile`/`WriteTextFile` passthrough.
- **Approval inline in chat:** When the agent hits a permission boundary, the approval request appears as a message in the conversation. The user approves or denies without leaving the chat.
- **Audit trail:** View all external requests the agent made, which were approved/denied, credential usage (from OneCLI logs via API Server).

---

## K8s Resource Model

### Why ConfigMaps, not CRDs

CRDs are the idiomatic Kubernetes pattern for custom resources and would give us schema validation, a `status` subresource, and native `kubectl` integration (`kubectl get agentinstances`). However, **CRDs require cluster-admin privileges to install**. This is a hard blocker for environments like OpenShift where teams get a namespace, not a cluster. ConfigMaps with labels are deployable by any user with namespace-level RBAC.

To mitigate ConfigMap limitations:
- **Single-writer keys:** Each ConfigMap uses separate data keys with a single owner: `spec.yaml` (API Server — user intent), `status.yaml` (Controller — infrastructure state). Each writer patches only their own key. No write contention. This mirrors the CRD `spec`/`status` subresource pattern. Lightweight application-level metadata (e.g. last activity timestamp) uses annotations on the ConfigMap metadata, which don't touch `data` at all.
- **Validation:** The API Server validates `spec.yaml` before writing. The Controller validates on read and writes errors to `status.yaml`.
- **Discovery:** `kubectl get cm -l humr.ai/type=agent-instance` lists all instances. Not as clean as `kubectl get agents` but functional.
- **Upgrade path:** If the project moves to a cluster where CRDs are available, the ConfigMap schema maps directly to a CRD spec. The Controller's reconcile logic barely changes — only the watch source is swapped.

### Agent Template

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: code-guardian
  namespace: adk-agents
  labels:
    humr.ai/type: agent-template
data:
  spec.yaml: |
    image: ghcr.io/myorg/code-guardian:latest
    description: "Persistent agent for repo monitoring"
    mounts:
      - path: /workspace
        persist: true
      - path: /home/agent
        persist: true
      - path: /tmp
        persist: false
    init: |
      #!/bin/bash
      if [ -f /workspace/requirements.txt ]; then
        pip install -r /workspace/requirements.txt
      fi
    env:
      - name: ACP_PORT
        value: "8080"
    resources:
      requests:
        cpu: "250m"
        memory: "512Mi"
      limits:
        cpu: "1"
        memory: "2Gi"
    securityContext:
      runAsNonRoot: true
      readOnlyRootFilesystem: false
```

### Agent Instance

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cg-team-alpha
  namespace: adk-agents
  labels:
    humr.ai/type: agent-instance
    humr.ai/template: code-guardian
data:
  # Written by API Server (user intent)
  spec.yaml: |
    desiredState: running    # running | hibernated
    env:
      - name: GITHUB_ORG
        value: "team-alpha"
    secretRef: cg-team-alpha-secrets

  # Written by Controller (reconciliation state — only what can't be
  # derived from K8s resources directly. Pod readiness, name, and IP
  # are available from the Pod object and stable DNS.)
  status.yaml: |
    currentState: running    # running | hibernated | error
    error: ""                # Controller-level errors (e.g. invalid template, OneCLI provisioning failure)

  # API Server writes activity state as annotations (not in data):
  # metadata.annotations:
  #   humr.ai/last-activity: "2026-04-01T14:30:00Z"
  #   humr.ai/active-session: "true"    # set on ACP session start, cleared on end
```

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cg-team-alpha-secrets
  namespace: adk-agents
  labels:
    humr.ai/type: agent-secret
    humr.ai/instance: cg-team-alpha
type: Opaque
data:
  GITHUB_TOKEN: <base64>
  LLM_API_KEY: <base64>
```

### Agent Schedule

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cg-team-alpha-heartbeat
  namespace: adk-agents
  labels:
    humr.ai/type: agent-schedule
    humr.ai/instance: cg-team-alpha
data:
  # Written by API Server (user config)
  spec.yaml: |
    type: heartbeat
    cron: "*/30 * * * *"
    task: ""
    concurrency: forbid       # forbid: skip if previous run still active
    enabled: true

  # Written by Controller (scheduler state)
  status.yaml: |
    lastRun: "2026-04-01T14:00:00Z"
    nextRun: "2026-04-01T14:30:00Z"
    lastResult: success
```

### Agent Trigger (ephemeral)

Written by the Controller's scheduler, consumed and deleted by the API Server. This is the mechanism by which the Controller requests the API Server to deliver a prompt to an agent pod — keeping the two components decoupled via K8s resources (Principle #7).

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cg-team-alpha-trigger-1711972800
  namespace: adk-agents
  labels:
    humr.ai/type: agent-trigger
    humr.ai/instance: cg-team-alpha
data:
  spec.yaml: |
    type: heartbeat
    prompt: ""                # empty = agent reads heartbeat.md
    metadata:
      scheduled: true
      scheduleRef: cg-team-alpha-heartbeat
```

### Reconciled Resources

For each instance ConfigMap, the Controller ensures:

```
ConfigMap (instance spec.yaml) + ConfigMap (template spec.yaml) + Secret
  → StatefulSet: {instance}
      replicas: from instance desiredState (hibernated=0, running=1)
      initContainer: template init script (runs in same image as main container)
      container: template image
        ports: [{ containerPort: 8080, name: acp }]
        readinessProbe:
          httpGet: { path: /healthz, port: acp }
          initialDelaySeconds: 5
          periodSeconds: 5
        livenessProbe:
          httpGet: { path: /healthz, port: acp }
          initialDelaySeconds: 15
          periodSeconds: 15
        env: merged (template + instance + platform: ADK_INSTANCE_ID, HTTPS_PROXY, etc.)
        envFrom: SecretRef
      securityContext: from template
      volumeMounts: per template mounts config (persist:true → PVC, persist:false → emptyDir)
      volumeClaimTemplates: one PVC per persist:true mount, named {instance}-{mount-name}
  → headless Service: {instance}
      clusterIP: None
      ports: [{ port: 8080, name: acp }]
      selector: humr.ai/instance: {instance}
      (enables stable DNS: {instance}-0.{instance}.{namespace}.svc)
  → NetworkPolicy: {instance}-egress
      egress: deny-all except OneCLI gateway, DNS
      ingress: allow ACP port from API Server pods only
```

---

## Key Flows

### 1. Create an instance

```
User -> Web UI: "Create instance from code-guardian template"
Web UI -> API Server: POST /api/v1/instances {template: "code-guardian", name: "cg-team-alpha", secrets: {...}}
API Server:
  1. Validates spec, creates instance ConfigMap (spec.yaml: desiredState: running)
  2. Creates Secret (humr.ai/type: agent-secret)
Controller (watching ConfigMaps):
  3. Detects new instance ConfigMap
  4. Reconciles: StatefulSet + headless Service + NetworkPolicy
     (PVCs created automatically by StatefulSet volumeClaimTemplates)
  5. Creates OneCLI agent token via OneCLI API (scoped per policy)
  6. Writes status.yaml: { currentState: running }
  7. Pod starts, init runs, readiness probe passes (ACP port responding)
API Server (watching Pod readiness via K8s API):
  8. Sees pod Ready condition, notifies UI via WebSocket
Web UI: instance ready, user can open chat
  9. User sends first message → API Server connects to
     cg-team-alpha-0.cg-team-alpha.adk-agents.svc:8080
     and relays ACP
```

### 2. Agent accesses GitHub

```
Claude Code: gh pr list
  -> HTTPS CONNECT api.github.com:443 via HTTPS_PROXY
  -> OneCLI gateway:
     1. Extract agent token from Proxy-Authorization
     2. Resolve: github provider, Bearer strategy
     3. Check policy rules (allowed? rate limited? needs approval?)
     4. MITM: terminate TLS, inject Authorization: Bearer <real-token>
     5. Forward to api.github.com
     6. Stream response back to agent
Agent sees: normal gh output, never sees the token
```

### 3. Agent hits policy boundary

```
Claude Code: gh repo delete org/repo
  -> HTTPS DELETE api.github.com/repos/org/repo
  -> OneCLI gateway:
     1. Policy rule matches: DELETE on /repos/* -> action: approval_required (future)
     2. Gateway holds request, notifies API Server
  -> API Server -> Web UI: "Agent wants to DELETE repos/org/repo. Approve?"
  -> User clicks "Deny"
  -> API Server -> OneCLI: reject
  -> OneCLI returns 403 to agent
  -> Claude Code sees: "Permission denied" and adjusts behavior
```

For v1 (before OneCLI has approval action):
- OneCLI blocks destructive operations via policy rules (hard boundary)
- Agent's CLAUDE.md instructs it to ask the user via ACP before destructive actions (soft boundary)
- User approves in chat, agent proceeds (agent makes the call, OneCLI allows it per policy)

### 4. Scheduled execution / heartbeat

```
Controller scheduler:
  1. Cron fires for instance cg-team-alpha
  2. Concurrency check: if concurrency: forbid and humr.ai/active-session
     annotation is "true", skip this trigger
  3. Instance hibernated? Patch instance spec.yaml: desiredState: running
  4. Reconcile: patch StatefulSet replicas: 1
  5. Wait for pod ready (readiness probe passes — K8s Pod Ready condition)
  6. Write trigger ConfigMap (humr.ai/type: agent-trigger)
  7. Update schedule status.yaml: lastRun, nextRun
API Server (watching trigger ConfigMaps):
  8. Detects trigger, connects to agent pod ACP port
  9. Delivers prompt via ACP (or empty prompt = agent reads heartbeat.md)
  10. Deletes trigger ConfigMap
  11. API Server updates humr.ai/last-activity annotation on instance ConfigMap
Controller:
  12. Detects inactivity, patches spec.yaml: desiredState: hibernated
  13. Reconciles: StatefulSet replicas: 0, PVCs persist
```

### 5. Resume a session

```
User -> Web UI: clicks on hibernated instance
Web UI -> API Server: POST /api/v1/instances/cg-team-alpha/wake
API Server:
  1. Patch instance ConfigMap spec.yaml: desiredState: running
Controller (watching):
  2. Reconcile: patch StatefulSet replicas: 1
  3. Pod starts, PVCs mount, readiness probe passes (ACP port responding)
API Server (watching Pod readiness): detects Ready condition, notifies UI
Web UI:
  1. API Server connects to agent pod ACP port
  2. session/list -> shows previous sessions from PVC
  3. session/load {id} -> agent replays conversation
  4. User continues where they left off
```

### 6. Hibernate

```
Controller reads instance annotation humr.ai/last-activity: older than TTL (default 3 days)
  (API Server updates annotation on ACP message relay)
Controller:
  1. Patches instance ConfigMap spec.yaml: desiredState: hibernated
  2. Reconciles: patches StatefulSet replicas: 0
  3. Pod terminates gracefully
  4. PVCs persist (StatefulSet preserves volumeClaimTemplates PVCs on scale-down)
  5. Schedules with enabled: true still fire — Controller will wake
     the instance, deliver the trigger, and re-hibernate after inactivity
```

---

## State Persistence

The PVC is the single source of truth for all instance state. No external database.

```
/workspace/                          # PVC: {instance}-workspace
├── .sessions/                       # ACP session state (agent-managed)
│   ├── sessions.db                  # session metadata + transcript
│   └── {session-id}/               # per-session artifacts
├── .config/                         # agent self-configuration
│   ├── soul.md                      # personality/identity
│   ├── rules.md                     # operating rules
│   └── heartbeat.md                 # periodic task definitions
├── memory/                          # accumulated knowledge
│   ├── 2026-04-01.md               # daily logs
│   └── bank/                       # curated knowledge
├── repos/                           # git clones
├── artifacts/                       # generated outputs
├── requirements.txt                 # declarative pip deps
└── .system-deps                     # declarative apt deps

/home/agent/                         # PVC: {instance}-home
├── .venv/                           # Python virtual environment
├── .npm/                            # npm cache
├── .bashrc                          # shell config
├── .ssh/                            # SSH keys (if configured)
└── .cache/                          # various caches
```

On restart: PVCs re-mount, init container reinstalls from manifests, agent loads sessions from PVC. No sync, no download, no external state.

---

## Security Model

### Layers

| Layer | Mechanism | Enforces | Bypassable? |
|-------|-----------|----------|-------------|
| Network | K8s NetworkPolicy | Pod can only reach OneCLI gateway, API Server, DNS | No (kernel-level, enforced by CNI) |
| Transport | OneCLI MITM proxy | All HTTPS traffic inspected, credentials injected | No (only route to internet) |
| Application | OneCLI policy rules | Block/rate-limit/approve specific host+path+method | No (gateway-enforced) |
| Behavioral | Agent rules (CLAUDE.md) | Agent asks before destructive actions | Yes (defense in depth, not a boundary) |

### What the agent cannot do

- **See real credentials:** Tokens are injected by OneCLI at request time. The agent has placeholder values.
- **Reach the internet directly:** NetworkPolicy drops all egress except gateway and API Server.
- **Access other instances' data:** Each instance has its own PVC, own agent token, own NetworkPolicy. No shared filesystem, no shared credentials.
- **Bypass policy:** Even if the agent crafts raw HTTP requests ignoring the proxy, they're dropped by NetworkPolicy. If it uses the proxy, OneCLI enforces policy.

### What we explicitly defer

- **DNS exfiltration:** Agent can resolve hostnames. Blocking this requires a DNS proxy, overkill for v1.
- **Kernel-level sandbox (gVisor/Kata):** NetworkPolicy + OneCLI is the security boundary. Container escape is a risk but mitigated by running as non-root. gVisor can be added later for high-security workloads.
- **Inter-pod network attacks:** Instances are isolated by NetworkPolicy but share a network namespace at the node level. Full network isolation requires per-instance namespaces (future).

---

## Protocol: ACP

The prototype uses the Agent Client Protocol (ACP) for harness-to-platform communication. ACP handles:

- **Session management:** Create, list, load, resume sessions (agent-managed on PVC)
- **Conversation relay:** User messages to/from the agent with streaming
- **File access:** `ReadTextFile`/`WriteTextFile` for workspace browsing from the UI
- **Terminal access:** `CreateTerminal`/`TerminalOutput` for live terminal in the UI
- **Permission requests:** `RequestPermission` for HiTL approval (built into protocol)
- **Modes:** ask/architect/code with different tool access and permission levels

The ACP connection topology (inbound to agent):
1. Agent pod starts, ACP server listens on port 8080, readiness probe passes
2. User opens chat in UI → UI WebSocket to API Server
3. API Server connects to agent pod via stable DNS: `{instance}-0.{instance}.{ns}.svc:8080`
4. API Server relays ACP messages bidirectionally: UI WebSocket ↔ agent pod WebSocket
5. If agent pod is unavailable (hibernated, crashed), API Server returns an error to UI with option to wake
6. API Server disconnects from agent pod when user closes chat (no persistent connection)

This is the same pattern as the current prototype's harness-runtime (listen on a port, accept connections), which means the agent pod code requires minimal changes. The API Server is the only component that initiates connections to agent pods — the NetworkPolicy enforces this.

Integration with A2A (Agent-to-Agent protocol) is used for scheduled triggers and inter-agent communication. ACP is the primary wire protocol for interactive use.

---

## Scheduling

Two scheduling modes, managed by the Controller's in-process scheduler:

**Cron:** Fixed schedule, deterministic. "Run at 9 AM every weekday." Wakes instance if hibernated, sends the configured prompt via A2A through the API Server.

**Heartbeat:** Periodic wake-up with open-ended prompt. "Wake up every 6 hours, review your history, decide what to do." The agent reads `heartbeat.md` and makes a judgment call.

**Concurrency policy:** `forbid` (default) skips the trigger if the instance has an active ACP session (checked via `humr.ai/active-session` annotation on the instance ConfigMap, written by the API Server). This is necessary because pods stay running between sessions — "pod is running" does not mean "agent is doing work." `allow` sends the trigger regardless.

Schedule state is split across ConfigMap keys: `spec.yaml` (user configuration, written by API Server) and `status.yaml` (scheduler state — `lastRun`/`nextRun`/`lastResult`, written by Controller). On Controller restart, it reads all schedule ConfigMaps and recomputes timers from `status.yaml`. No external database dependency.

**Trigger delivery is decoupled:** The Controller writes a trigger ConfigMap. The API Server watches for triggers, connects to the agent pod, delivers the prompt, and deletes the trigger. This keeps Principle #7 (no direct Controller→API Server calls).

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Controller | Go | First-class K8s client (`client-go`), single binary, operator upgrade path |
| API Server | TypeScript / Node.js | Shares ecosystem with UI, existing ACP SDK integration, WebSocket-native |
| OneCLI Gateway | Rust (existing) | Used directly, high-performance MITM proxy |
| Web UI | React 18 + Vite | Existing prototype, WebSocket support, rich chat interface |
| Agent harness | Claude Code (first target) | Highest adoption, clearest pattern |
| Agent pod runtime | TypeScript / Node.js | Evolution of existing harness-runtime prototype |
| Storage | Filesystem PVCs | Pay-per-use on all cloud providers |
| Database | **None** | K8s ConfigMaps + Secrets. Controller + API Server are stateless. |
| Scheduling | In-process (Go, Controller) | Schedule state in ConfigMaps, no external dependency |

---

## OneCLI Integration Details

### K8s Deployment

OneCLI ships as Docker images only (no Helm chart). We deploy it as two K8s Deployments + Services: gateway (port 10255) and web app (port 10254).

**Note:** OneCLI itself uses PostgreSQL for its own state (agents, secrets, policy rules). This is OneCLI's internal dependency, not ours. The Controller interacts with OneCLI via its REST API. Neither the Controller nor the API Server share or depend on OneCLI's database.

**MITM TLS is required.** The agent makes HTTPS calls to external services (`https://api.github.com`). For OneCLI to inject credentials into those requests, it must terminate TLS, modify headers, and re-encrypt toward the upstream.

**CA certificate flow:**
1. OneCLI gateway supports CA injection via `GATEWAY_CA_KEY` + `GATEWAY_CA_CERT` env vars.
2. Store CA key + cert in a K8s Secret. Gateway reads from env vars on startup.
3. The CA cert (public half) goes into a ConfigMap that agent pods mount read-only.
4. Agent pods set `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS` pointing at the mounted cert.
5. Agent pods set `HTTPS_PROXY` / `HTTP_PROXY` to the gateway service address.

### API Integration

The Controller interacts with OneCLI programmatically:
- **Agent token creation:** Creates a per-instance OneCLI agent via REST API, with scoped credentials and policy rules. Each agent gets an access token (`aoc_...`) used in `Proxy-Authorization` headers.
- **Policy rule management:** Creates/updates/deletes policy rules via the OneCLI API, scoped to the instance's agent ID.
- **Cache invalidation:** After rule changes, calls `POST /api/cache/invalidate` on the gateway.

---

## Prototype Scope (v1)

**In scope:**
- Controller (Go) with ConfigMap watchers + reconciliation + leader election + in-process scheduler
- API Server (TypeScript) with REST API + WebSocket ACP relay + trigger delivery + static UI serving
- Instance lifecycle: create, hibernate, wake, delete
- StatefulSet + headless Service + NetworkPolicy per instance (PVCs via volumeClaimTemplates)
- OneCLI integration (credential injection for GitHub)
- ACP relay (UI → API Server → agent pod ACP port, bidirectional WebSocket)
- Scheduled execution (cron + heartbeat via trigger ConfigMaps)
- Web UI (React): instance list, chat, file browser, session management
- Claude Code as first harness
- Agent template / instance ConfigMap format with spec/status key split
- Agent pod: evolution of existing harness-runtime (listens on ACP port, accepts connections from API Server)
- Readiness + liveness probes on agent pods

**Out of scope for v1:**
- OneCLI approval action (use block rules + agent soft-ask for v1)
- OneCLI default-deny posture (use NetworkPolicy as hard boundary, contribute upstream)
- Channel integrations (Slack, Teams, Telegram)
- Multi-cluster / multi-node production deployment
- Operator CRDs (requires cluster-admin; keep ConfigMaps for namespace-level deployability)
- Sub-agent composition (instances creating other instances)
- gVisor / kernel-level sandbox
- Multi-user / RBAC
- fuse-overlayfs for full filesystem persistence

## Open Questions

1. **Claude Code subscription vs API key:** Can we use a Claude Code subscription in this context (ToS)? API key usage is expensive for sustained work.
2. **ACP maturity:** ACP is relatively new. How stable is the protocol? Do we need a fallback (e.g. stdin/stdout relay)?
3. **OneCLI upstream collaboration:** How receptive are the OneCLI maintainers to default-deny mode and approval actions? Should we fork or contribute?
4. ~~**ACP transport:** Direct WebSocket from UI to pod Service, or always proxy through API Server?~~ **Resolved:** Always proxy through API Server. API Server connects to agent pods via stable DNS (headless Service). UI connects to API Server. Agent pods just listen on a port — same pattern as the current prototype.
5. ~~**Controller language:** Go is proposed for `client-go`. Python is the team's primary expertise. Tradeoff?~~ **Resolved:** Go for Controller (reconciliation, `client-go`), TypeScript for API Server (WebSocket, ACP SDK, UI ecosystem).
6. ~~**Wake-on-connect:** Can the API Server intercept ACP connections to a hibernated instance and auto-wake?~~ **Resolved:** Yes. API Server detects hibernated state from instance `status.yaml`, patches `spec.yaml` with `desiredState: running`, Controller reconciles, API Server watches Pod until Ready condition is true, then connects to agent pod.
7. **OneCLI's own PostgreSQL:** OneCLI needs PostgreSQL for its internal state. This is the only database in the system. Can we minimize it (SQLite mode? embedded?) or is it acceptable as OneCLI's problem?
8. **PVC storage class:** Default size limits per template? Storage class requirements? StatefulSet `volumeClaimTemplates` need a storage class — should templates specify this or use a cluster default?
9. **Namespace strategy:** Single namespace (`adk-agents`) or namespace-per-team?
10. ~~**Activity tracking for auto-hibernate:** API Server tracks last ACP activity per instance. How to communicate this to Controller?~~ **Resolved:** API Server patches two annotations on the instance ConfigMap: `humr.ai/last-activity` (timestamp) and `humr.ai/active-session` ("true"/"false"). Annotations don't touch `data`, so zero conflict with Controller writing `status.yaml`. Controller reads `last-activity` for TTL-based hibernation and `active-session` for concurrency checks.
