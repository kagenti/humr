# Chatting with Your Agent

Click on an instance to open the chat view. Type a message and the agent responds — just like running the agent locally, except it's in the cloud and persists when you close your browser.

## Sessions

Each conversation is a **session**. Sessions are persistent — close the tab, come back tomorrow, your conversation is still there. Closing your browser tab doesn't end the session; the agent process keeps running and can serve multiple sessions concurrently (including from Slack threads).

You can have multiple sessions with the same instance. Each session has its own independent conversation history.

## What the agent can do

The agent has a full Linux environment with access to:

- **A shell** — it can run commands, install packages, write scripts
- **Git** — it can clone repos, make commits, open PRs
- **Persistent storage** — files in `/home/agent` (including the `/home/agent/work` directory) survive restarts
- **Any connections you've configured** — API keys, GitHub, Google Workspace, etc.

The agent **cannot** access the internet directly. All outbound traffic is routed through the OneCLI credential proxy, which decides per-host whether to inject credentials and forward the request. If there's no matching grant, the request fails. This is a security feature, not a bug — see [Add Credentials](credentials.md) for how it works.

## Starting a new session

To start a fresh conversation without losing the old one, create a new session from the chat view. The home directory is shared across sessions, but conversation history is per-session.
