# Architecture Decision Records

This directory contains ADRs for the Humr project.

## Accepted

| ADR | Title | Owner |
|-----|-------|-------|
| [001](001-ephemeral-containers.md) | Ephemeral containers + persistent workspace volumes | @tomkis |
| [002](002-memory-primitives.md) | Memory — platform provides primitives, agents own semantics | @tomkis |
| [003](003-k8s-from-the-start.md) | Kubernetes from the start — k3s for local dev, K8s for production | @jezekra1 |
| [004](004-acp-over-a2a.md) | ACP over A2A for the experiment | @tomkis |
| [005](005-credential-gateway.md) | Gateway pattern for credentials — agent never sees tokens | @pilartomas |
| [006](006-configmaps-over-crds.md) | ConfigMaps over CRDs — namespace-scoped resource model | @jezekra1 |
| [007](007-acp-relay.md) | ACP traffic always proxied through the API Server | @tomkis |
| [008](008-trigger-files.md) | Controller-owned cron with exec-based trigger delivery | @jezekra1 |
| [009](009-go-and-typescript.md) | Go for Controller, TypeScript for API Server | @jezekra1 |
| [010](010-onecli-deployment.md) | OneCLI deployment — single image, two Services | @pilartomas |
| [011](011-skills-claude-marketplace.md) | Skills via Claude plugin marketplace | @pilartomas |

## Drafts

| Draft | Title | Owner |
|-------|-------|-------|
| [DRAFT](DRAFT-runtime-lifetime.md) | Runtime lifetime — keep-alive vs. kill after response | @JanPokorny |
| [DRAFT](DRAFT-ui-tooling.md) | UI wireframes and tooling | @PetrBulanek |
| [DRAFT](DRAFT-skills-harness-native.md) | Skills — harness-native, not platform-managed | @pilartomas |
