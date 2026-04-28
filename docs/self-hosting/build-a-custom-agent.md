# Build a Custom Agent

Humr ships with built-in templates for Claude Code and pi.dev. You can create your own template for any harness that speaks [ACP](https://agentclientprotocol.com/get-started/introduction) — Codex, Gemini CLI, or something you've built yourself.

## How templates work

A template is a ConfigMap with a `humr.ai/type: agent-template` label. It defines:

- **Image** — the container image to run
- **Agent command** — the entrypoint command (set via `AGENT_COMMAND` env var)
- **Resource limits** — CPU and memory allocation
- **Init script** — optional setup that runs before the agent starts

When you create an instance from a template, Humr's controller creates a StatefulSet, a PVC for the workspace, and network policies for isolation. The network policy is a strict allow-list — agent pods can only reach the OneCLI credential proxy, the API server's internal port, and DNS. There is no direct internet egress; all outbound HTTPS is forced through the credential proxy.

## The base image

All built-in agents extend `humr-base`, a minimal image that includes:

- The **agent runtime** — the ACP WebSocket server that bridges the harness to Humr's API server
- A **trigger watcher** — picks up scheduled task files from `/home/agent/.triggers/`
- Standard tooling (Node.js, git, common CLI utilities)

Your custom image should extend `humr-base` and add whatever your harness needs.

## Example: custom Dockerfile

```dockerfile
FROM humr-base:latest

# Install your harness
RUN npm install -g my-agent-harness

# The agent runtime reads this to know what to launch
ENV AGENT_COMMAND="my-agent-harness start"
```

## Persistent paths

`/home/agent` survives pod restarts — this includes the working directory at `/home/agent/work`, globally installed tools (`npm install -g`, `uv tool install`), and dotfiles. Everything else is ephemeral. System-level changes (`apt install`, `/etc` edits) should go in the template image.

## Deploy your template

Build your image and make it available to the cluster, then create a ConfigMap with the template spec. The easiest way is to add it to the Helm chart values or create it with kubectl:

```sh
mise run cluster:kubectl -- apply -f my-template.yaml
```

The template will appear in the Humr UI's **Add Agent** dialog.
