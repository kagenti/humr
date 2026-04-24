# Connect to Slack

If your Humr instance has Slack integration enabled, you can route agent conversations through Slack channels.

## Connect an instance to a channel

1. In the Humr UI, click the **Slack icon** on your instance.
2. Pick a Slack channel to connect.
3. Messages in that channel's threads are routed to your agent.

## Link your Slack identity

Run `/humr login` in Slack to link your Slack account to your Humr identity. You'll be prompted automatically if you haven't linked yet.

## How thread routing works

- **One instance per channel** — messages route automatically.
- **Multiple instances in one channel** — a dropdown lets you pick which agent to talk to. Your choice persists for the thread.
- **Each thread is a separate session** — messages in different threads don't cross.

## Access control

Instance owners can set an **allowed-users list**. When configured, only listed users can interact with the agent in Slack. When the list is empty, all channel members have access. Unauthorized users see an ephemeral rejection message.

## Replying in someone else's thread

If you reply in a Slack thread that belongs to another user's agent, Humr automatically forks the instance into a short-lived job. Your conversation stays isolated — you don't see their data and they don't see yours.
