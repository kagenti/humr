# Multi-User & Sharing

Agents are owned by the user who created them. Here's how to collaborate with your team.

## Add allowed users

In the **Config** tab under **Channels**, list the team members who should be able to interact with this instance. Each user must have their own Humr account (Keycloak login). Only the owner and explicitly listed users can interact.

## Credential isolation

When a team member who isn't the owner interacts via Slack, Humr automatically forks the agent into a short-lived job that runs under that person's own credentials. They can see the workspace, but they can only call external services using their own grants. See [Connect to Slack — Replying in someone else's thread](slack.md#replying-in-someone-elses-thread) for details.

## Shared channels

Connect an agent to a Slack channel and multiple people can use it simultaneously. Each Slack thread becomes an isolated session, so conversations don't interfere with each other. See [Connect to Slack](slack.md) for setup.
