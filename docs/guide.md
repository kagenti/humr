# Guide

Reference for [Humr](../README.md), a Kubernetes platform for running background coding agents.

## Configuration

Agents and other connections require API tokens to communicate with their providers. These secrets are managed through the OneCLI dashboard at [onecli.localhost:4444](http://onecli.localhost:4444).

OneCLI acts as a proxy — agents never see the secrets directly. Instead, OneCLI intercepts outgoing requests from agent pods and injects the appropriate credentials before forwarding them to the provider.

1. **Add a secret** — open the OneCLI UI and create a new secret. For Anthropic, you can use `claude setup-token` as the token value. For other connections, use Apps or Generic secret.
2. **Allow the secret for an agent** — in the OneCLI UI, grant the secret to the specific agent that needs it. Only requests from allowed agents will have credentials injected.

## Slack Integration

Humr runs a single Slack app (Socket Mode) for the entire installation. Multiple instances can share a channel — the bot routes messages per thread.

1. [Create a Slack app](https://api.slack.com/apps) with Socket Mode enabled and bot/user token scopes: `app_mentions:read`, `channels:history`, `chat:write`, `reactions:write`, `commands`, `users:read`.
2. Add slash command `/humr` pointing to your app.
3. Generate an app-level token (`xapp-...`) with `connections:write` scope. Deploy with both tokens:

   ```sh
   mise run cluster:install -- \
     --set=apiServer.slackBotToken=xoxb-... \
     --set=apiServer.slackAppToken=xapp-...
   ```

4. In the Humr UI, click the Slack icon on any instance to connect it to a channel. Optionally configure an allowed-users list in instance settings.

**Identity linking** — users run `/humr login` in Slack to link their Slack account to Keycloak. Unlinked users are prompted automatically.

**Routing** — single-instance channels auto-route. Multi-instance channels show a dropdown to pick the target instance; the choice persists for the thread.

**Access control** — per-instance allowed-users list (empty = open to all channel members). Unauthorized users get an ephemeral rejection.

## Development

```sh
mise run check              # lint + type-check
mise run test               # run tests
mise run ui:run             # start UI dev server
```

Humr detects it is running in a sandbox by env `IS_SANDBOX` and skips provisioning the Lima VM, instead installing k3s directly to avoid nested virtualization.

## Architecture

- **Controller** (Go) — K8s reconciler + cron scheduler
- **API Server** (TypeScript) — REST API + ACP WebSocket relay + serves UI
- **Agent Runtime** (TypeScript) — ACP server inside each agent pod
- **OneCLI** — credential injection proxy, network policy enforcement
- **Web UI** (React) — instance management, chat, scheduling
