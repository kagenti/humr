# ADR-016: Messenger integration handled by API Server

**Date:** 2026-04-09
**Status:** Draft
**Owner:** @tomkis

## Context

Humr needs to support instant messengers (starting with Slack) as conversational interfaces — when an agent instance is mentioned in a channel, it should wake up, run a session, and reply. The bot token is a per-tenant credential managed via OneCLI (same as GitHub tokens, API keys, etc.).

Key constraints:
- The agent pod can be scaled to zero after inactivity — a sidecar would die with it and miss mentions
- The bot must stay alive to listen for mentions even when the agent is hibernating
- In a multi-tenant setup, each tenant brings their own bot token
- The response must stream back to the messenger (bidirectional, not fire-and-forget)

## Decision

The **API Server** handles messenger integrations directly. It already watches instance ConfigMaps, manages ACP relay connections, and can wake hibernated instances — all the pieces needed. No new Deployment.

When the API Server sees a messenger trigger in an instance ConfigMap, it:

1. Establishes a messenger connection using the bot token (injected via OneCLI)
2. Listens for mentions via messenger API (Slack Events API, etc.)
3. On mention: wakes the instance if hibernated
4. Creates a **new ACP session** with messenger conversation history as context
5. Streams the ACP response back to the messenger
6. Buffers incoming messages while waiting for pod wake-up

A single API Server process holds multiple messenger connections with different tokens concurrently. Adding/removing messenger configs on instances dynamically creates/tears down connections.

### Session model

Each @mention creates a **new ACP session** — stateless from the ACP perspective. All context comes from the messenger API:

- **Mention in a thread** → new session, full thread history injected as context
- **Mention in a channel** (no thread) → new session, last N messages injected as context

No session-to-thread mapping, no persistent state in the bot. The messenger is the source of truth for conversation history.

Sessions carry `_meta: { source: "slack", channelId: "..." }` so the UI can filter them out — messenger sessions are headless.

### Instance configuration

```yaml
spec:
  triggers:
    slack:
      channelId: "C0123ABCDEF"
```

The pattern is the same for any messenger — a different trigger key and token type:

```yaml
spec:
  triggers:
    discord:
      channelId: "123456789"
```

The API Server watches for ConfigMap changes and dynamically adds/removes messenger connections.

## Alternatives Considered

**Sidecar container in the agent pod.** Bot runs as a sidecar alongside agent-runtime. Rejected: when the pod scales to zero on inactivity, the bot dies and misses mentions. The bot must have an independent lifecycle.

**Dedicated messenger-gateway Deployment.** Separate always-on Deployment for messenger connections. Rejected: the API Server already has everything needed (ConfigMap watching, ACP relay, instance wake). A separate service adds operational overhead for no benefit.

**Deployment per instance.** Each instance with a messenger trigger gets its own bot Deployment. Rejected: a single process can hold multiple messenger connections with different tokens. Causes Deployment proliferation.

**Trigger file delivery (like cron, ADR-008).** Bot writes trigger files via Controller. Rejected: trigger files are fire-and-forget with no response channel. Messengers require bidirectional communication to stream replies back.

**Persistent session per channel/thread.** Map thread or channel to a long-lived ACP session. Rejected: the messenger already holds conversation history — duplicating it in the ACP session adds complexity and state management. Fetching history from the messenger API on each mention is simpler and keeps the bot stateless.

## Consequences

- No new infrastructure — messenger handling lives in the existing API Server
- Reuses existing ACP relay, ConfigMap watching, and instance wake logic
- Stateless — no session mapping to persist, all context sourced from messenger API
- Adding a new messenger type requires only a new adapter module in the API Server
- API Server becomes a larger single point of failure (now also handles messenger connections)
- Must handle reconnection, message buffering during pod wake-up, and messenger rate limits
- Can be extracted into a separate service later if scale demands it
