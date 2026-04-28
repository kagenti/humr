# Connect to Slack

If your Humr instance has Slack integration enabled, you can route agent conversations through Slack channels.

## Connect an instance to a channel

1. Open an instance, go to the **Config** tab, and find the **Channels** section.
2. Enable the Slack channel and enter the **Channel ID** of the Slack channel you want to connect (e.g. `C0ABC123`).
3. Messages in that channel's threads are routed to your agent.

## Link your Slack identity

Run `/humr login` in Slack to link your Slack account to your Humr identity. **This is required** — you cannot interact with any agent from Slack until your identity is linked. You'll be prompted automatically if you haven't linked yet.

## How thread routing works

- **One instance per channel** — each Slack channel can be connected to one agent instance. Messages route automatically.
- **Each thread is a separate session** — messages in different threads don't cross.

## Access control

Instance owners can set an **allowed-users list** to control who can interact with the agent. Only the owner and listed users can drive sessions. Unauthorized users see an ephemeral rejection message.

## Replying in someone else's thread

If you reply in a Slack thread that belongs to another user's agent, Humr automatically forks the instance into a short-lived job that runs under **your** credentials, not the owner's. The fork can read files in the owner's workspace (it mounts the same volume), but it can only call external services using your own credential grants — not the owner's. This means the fork can see the workspace context but cannot exfiltrate it through any service you haven't been granted access to.
