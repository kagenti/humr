# Architecture Decision Records

This directory contains ADRs for the Humr project.

## Accepted

| ADR                                           | Title | Owner |
|-----------------------------------------------|-------|-------|
| [001](001-ephemeral-containers.md)            | Ephemeral containers + persistent workspace volumes | @tomkis |
| [002](002-memory-primitives.md)               | Memory — platform provides primitives, agents own semantics | @tomkis |
| [003](003-k8s-from-the-start.md)              | Kubernetes from the start — k3s for local dev, K8s for production | @jezekra1 |
| [004](004-acp-over-a2a.md)                    | ACP over A2A for the experiment | @tomkis |
| [005](005-credential-gateway.md)              | Gateway pattern for credentials — agent never sees tokens | @pilartomas |
| [006](006-configmaps-over-crds.md)            | ConfigMaps over CRDs — namespace-scoped resource model | @jezekra1 |
| [007](007-acp-relay.md)                       | ACP traffic always proxied through the API Server | @tomkis |
| [008](008-trigger-files.md)                   | Controller-owned cron with exec-based trigger delivery | @jezekra1 |
| [009](009-go-and-typescript.md)               | Go for Controller, TypeScript for API Server | @jezekra1 |
| [010](010-onecli-deployment.md)               | OneCLI deployment — single image, two Services | @pilartomas |
| [011](011-skills-claude-marketplace.md)       | Skills via Claude plugin marketplace | @pilartomas |
| [012](012-runtime-lifetime.md)                | Runtime lifetime — single-use Jobs | @JanPokorny |
| [013](013-ui-approach.md)                     | UI approach — chat-primary, dashboard for inspection | @PetrBulanek |
| [014](014-integration-testing.md)             | E2E integration testing against dedicated k3s cluster | @tomkis |
| [015](015-multi-user-auth.md)                 | Multi-user auth via Keycloak + OneCLI fork with token exchange | @tomkis |
| [016](016-messenger-integration.md)           | Messenger integration handled by API Server | @tomkis |
| [017](017-db-backed-sessions.md)              | DB-backed ACP sessions for metadata | @tomkis |
| [018](018-slack-integration.md)               | Slack integration — Socket Mode, channel-based routing, identity linking | @tomkis |
| [019](019-session-identity.md)                | Scheduled session identity and lifecycle | @janjeliga |
| [020](020-responsive-ui-pwa.md)               | Responsive mobile UI, ACP session controls, PWA | @jezekra1 |
| [021](021-slack-outbound.md)                  | Slack outbound messaging — MCP tool with per-agent token auth | @tomkis |
| [022](022-harness-api-server.md)              | Harness API server — separate port with restricted API surface | @tomkis |
| [023](023-harness-agnostic-base-image.md)     | Harness-agnostic agent base image (`humr-base` + `AGENT_COMMAND`) | @tomas |
| [024](024-connector-declared-envs.md)         | Connector-declared pod envs + per-agent env overrides | @tomas |
| [025](025-thread-session.md)                  | Persistent ACP session per Slack thread | @tomkis |
| [026](026-session-log-replay.md)              | Persistent ACP sessions via per-session log and cursor fan-out | @jezekra1 |
| [027](027-slack-user-impersonation.md)        | Slack per-turn user impersonation — foreign repliers fork the instance into a K8s Job | @tomkis |
| [028](028-generic-secret-injection-config.md) | Configurable injection on generic secrets (host/path + custom header) | @tomas2d |

## Drafts

| Draft | Title | Owner |
|-------|-------|-------|
| [DRAFT](DRAFT-skills-harness-native.md) | Skills — harness-native, not platform-managed | @pilartomas |
| [DRAFT](DRAFT-multi-agent.md) | Multi-agent collaboration — isolated instances with shared artifacts | @tomkis |
| [DRAFT](DRAFT-channel-secret-storage.md) | Per-instance channel secret storage | @pilartomas |
