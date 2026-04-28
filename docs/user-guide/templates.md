# Agent Templates

When you click **Add Agent**, you pick a template. Each template defines the container image, harness command, resource limits, and an init script that runs before the agent starts.

## Built-in templates

Humr ships with four templates. Only `claude-code` is enabled by default — the others can be turned on in the Helm values.

### Claude Code

The default template. Runs [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) as the agent harness. Good for general-purpose coding, automation, and any task that benefits from a full development environment.

Requires an Anthropic API key (or a compatible provider) configured on the **Providers** page.

### Pi Agent

Runs the [pi coding agent](https://github.com/mariozechner/pi-coding-agent) with multi-LLM support. Pi can talk to OpenAI, Anthropic, GitHub Models, and other providers — configure whichever keys you need on the **Providers** page.

### Google Workspace

A Claude Code agent with the [Google Workspace CLI](https://github.com/nicholasgasior/gws) pre-installed. Use it to read and write Google Docs, Sheets, and Gmail programmatically. Requires both an Anthropic API key and Google OAuth credentials.

### Code Guardian

A PR review bot built on Claude Code and the GitHub CLI. Point it at a repository, connect it to a Slack channel, and it will review pull requests automatically.

Set `GITHUB_REPO` (e.g. `owner/repo`) in the template config, or leave it empty to auto-detect from the workspace. Requires an Anthropic API key and a GitHub token.

## Custom templates

You can create your own template for any harness that speaks [ACP](https://agentclientprotocol.com/get-started/introduction) — Codex, Gemini CLI, or something you've built.

### How templates work

A template is a Kubernetes ConfigMap with a `humr.ai/type: agent-template` label. It defines:

- **Image** — the container image to run
- **Agent command** — the entrypoint command (set via `AGENT_COMMAND` env var)
- **Resource limits** — CPU and memory allocation
- **Init script** — optional setup that runs before the agent starts

When you create an instance from a template, Humr's controller creates a StatefulSet, a PVC for the workspace, and network policies for isolation. Agent pods can only reach the credential proxy, the API server, and DNS — there is no direct internet egress.

### The base image

All built-in agents extend `humr-base`, a minimal image that includes:

- The **agent runtime** — the ACP WebSocket server that bridges the harness to Humr's API server
- A **trigger watcher** — picks up scheduled task files from `/home/agent/.triggers/`
- Standard tooling (Node.js, git, common CLI utilities)

Your custom image should extend `humr-base` and add whatever your harness needs.

### Example Dockerfile

```dockerfile
FROM humr-base:latest

# Install your harness
RUN npm install -g my-agent-harness

# The agent runtime reads this to know what to launch
ENV AGENT_COMMAND="my-agent-harness start"
```

### Persistent paths

`/home/agent` survives pod restarts — this includes the working directory at `/home/agent/work`, globally installed tools (`uv tool install`), and dotfiles. Everything else is ephemeral. System-level changes should go in the template image.

### Deploy your template

Build your image and make it available to the cluster, then create a ConfigMap with the template spec:

```sh
kubectl apply -f my-template.yaml
```

The template will appear in the **Add Agent** dialog.
