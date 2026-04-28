# Manage Your Agent

## Configuration

Open an instance and go to the **Config** tab to adjust:

- **Channels** — connect a Slack channel and manage the allowed-users list
- **Schedules** — create and manage recurring tasks

Agent-level settings (connections, environment variables) are managed via the **Configure** button on the agents list.

## Sharing with your team

Agents are owned by the user who created them. To collaborate:

- **Add allowed users** — in the Channels section, list the team members who should be able to interact with this instance. Each user must have their own Humr account (Keycloak login). Only the owner and explicitly listed users can interact.
- **Connect to a Slack channel** — see [Connect to Slack](slack.md). Each Slack thread becomes an isolated session, so multiple people can use the same agent without interfering with each other.
- **Credential isolation** — when a team member who isn't the owner interacts via Slack, Humr automatically forks the agent into a short-lived job that runs under that person's own credentials. They can see the workspace, but they can only call external services using their own grants. See [Connect to Slack § Replying in someone else's thread](slack.md#replying-in-someone-elses-thread) for details.

## Hibernation

Idle agents can be **hibernated** to save resources. The pod shuts down but the workspace volume is preserved. When you wake the agent, it comes back with the same files, tools, and conversation history.

Your admin may configure auto-hibernation after a period of inactivity (default: 1 hour). You can also manually hibernate and wake agents from the UI. Sending a message to a hibernated agent (from the UI or Slack) wakes it automatically — you don't need to manually wake it first.

## Resetting an agent

If the agent gets into a bad state:

- **Hibernate and wake** — gives you a fresh process with the same workspace.
- **Ask an admin to delete the pod** — Kubernetes replaces it automatically. Same workspace, clean process.

## Tips

- See [Files & Workspace](files.md) for details on what persists across restarts.
