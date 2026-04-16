# Humr

```
 ╦ ╦╦ ╦╔╦╗╔═╗
 ╠═╣║ ║║║║╠╦╝
 ╩ ╩╚═╝╩ ╩╩╚═

 Run AI harnesses in production.
 Isolated. Credentialed. Scheduled.
```

Kubernetes platform for running AI agent harnesses (Claude Code, Codex, Gemini CLI) in isolated environments with credential injection, network isolation, and scheduled execution.

## Guided Tour

Open your favorite AI coding agent in the repo and try:

```
Walk me through how Humr works step by step. I want to do a demo for myself.
Explain how things work on the way. Help me connect a model provider, create
an instance, add a connection to GitHub, and chat with an agent.
```

It has full context of the codebase, architecture decisions, and cluster commands. It will guide you through setup, credential injection, and your first chat.

See [PITCH.md](PITCH.md) for the full story of what Humr is and why it exists.

## Quick Start

For those who prefer pasting commands into a terminal:

```sh
mise install                # install deps, configure git hooks
mise run cluster:install    # create local k3s cluster + deploy (or upgrade) Humr
mise run cluster:status     # check pods
export KUBECONFIG="$(mise run cluster:kubeconfig)" # activate cluster env
```

Open **`humr.localhost:4444`** in your browser, create an instance from a template, and start chatting.

## Configuration

Agent harnesses and other connections require API tokens to communicate with their providers. These secrets are managed through the OneCLI dashboard at **`onecli.localhost:4444`**.

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
