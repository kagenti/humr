# Settings & Lifecycle

## Instance settings

Open an instance and click **Settings** to configure:

- **Name and description** — identify your agent
- **Allowed users** — control who can interact with this instance (empty = open to everyone)
- **Environment overrides** — add custom environment variables to the agent pod
- **Connections** — manage which credentials and OAuth apps are available

## Hibernation

Idle agents can be **hibernated** to save resources. The pod shuts down but the workspace volume is preserved. When you wake the agent, it comes back with the same files, tools, and conversation history.

Your admin may configure auto-hibernation after a period of inactivity (default: 1 hour). You can also manually hibernate and wake agents from the UI.

## Resetting an agent

If the agent gets into a bad state:

- **Hibernate and wake** — gives you a fresh process with the same workspace.
- **Ask an admin to delete the pod** — Kubernetes replaces it automatically. Same workspace, clean process.

## Tips

- **Share an agent with your team** by connecting it to a [Slack channel](slack.md) and configuring the allowed-users list. Each thread is an isolated session.
- See [Files & Workspace](files.md) for details on what persists across restarts.
