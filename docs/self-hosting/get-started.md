# Get Started

Install Humr and have your first agent running in about 5 minutes.

## Prerequisites

- [mise](https://mise.jdx.dev) — manages all other tooling automatically
- A Docker-compatible runtime (Docker Desktop, Rancher Desktop, etc.)
- macOS or Linux

## Install

```sh
git clone https://github.com/kagenti/humr && cd humr
mise install                # install toolchain + deps
mise run cluster:install    # create local k3s cluster + deploy Humr
```

This boots a k3s cluster inside a lima VM and deploys the full stack: credential proxy (OneCLI), identity provider (Keycloak), database, controller, API server, and UI.

!!! note "Local cluster limitations"
    The local cluster runs inside a VM on your machine. When your laptop sleeps, the VM suspends — scheduled tasks won't fire and agents won't be reachable. This setup is for development and evaluation. For always-on agents, [deploy to Kubernetes](deploy.md).

## Log in

Open [humr.localhost:4444](http://humr.localhost:4444) and log in with `dev` / `dev`. The OneCLI dashboard is at [onecli.localhost:4444](http://onecli.localhost:4444) with the same credentials.

All services are routed through Traefik on port 4444, auto-forwarded by lima.

## Create your first agent

1. In the Humr UI, click **Add Agent** and pick the `claude-code` template. Give it a name (e.g. `demo`). The pod will be ready in ~20 seconds.
2. You'll need to [add credentials](../user-guide/credentials.md) before the agent can talk to a model provider.
3. Once credentials are configured, open the instance and start chatting.

## Cluster commands

```sh
mise run cluster:status       # show pods and cluster state
mise run cluster:logs         # tail OneCLI pod logs
mise run cluster:stop         # stop the VM (preserves data)
mise run cluster:install      # upgrade an existing cluster after code changes
mise run cluster:build-agent  # rebuild agent image only, restart agent pods
mise run cluster:delete       # destroy the VM entirely
```

For interactive kubectl access:

```sh
export KUBECONFIG="$(mise run cluster:kubeconfig)"
```

## Next steps

- [Add Credentials](../user-guide/credentials.md) — configure API keys so your agent can reach model providers
- [Chatting with Your Agent](../user-guide/chatting.md) — sessions, workspace, what the agent can do
- [Connect to Slack](../user-guide/slack.md) — bring your agents into Slack channels
