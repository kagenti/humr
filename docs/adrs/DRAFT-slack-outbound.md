# ADR-DRAFT: Slack outbound messaging — MCP tool

**Date:** 2026-04-16
**Status:** Proposed
**Owner:** @tomkis

## Context

ADR-018 established Slack integration as inbound-only: users mention `@Humr` in Slack, messages route to agent instances, responses flow back in-thread. Agents have no way to initiate messages to Slack.

Agents need to post proactively — scheduled job results, status updates, and other agent-initiated communication. The current channel configuration UI (a tab inside ChatView) also needs rework since channel config is an instance-level concern, not something configured mid-chat.

## Decision

### 1. Single delivery mode — MCP tool

```
send_slack_message(text: string) → { ok: true } | { error: string }
```

The agent explicitly decides what and when to post. Same mechanism for both interactive and scheduled sessions.

Flow: harness → MCP tool → API Server → SlackWorker → Slack.

**MCP endpoint** hosted on the API Server Hono app at `/api/instances/:id/mcp` using Streamable HTTP transport. Direct access to SlackWorker — no agent-runtime round-trip. Auth uses the same mechanism as the existing ACP WebSocket relay.

- Tool **always registered** regardless of outbound state; calls rejected at invocation time when outbound is disabled or no channel connected
- Returns errors from Slack (bot removed, invalid channel) — harness handles
- Messages posted as plain text with instance name in a context block

### 2. Per-session outbound flag

Outbound is opt-in per session:

- **Instance channel config** = inbound direction (existing, always on when connected)
- **Session outbound flag** = gates `send_slack_message` calls for that specific session
- Flag **persisted in DB** keyed by session ID, default `false` (survives page refresh)
- For scheduled sessions: auto-set from schedule-level `slackOutbound` config when trigger spawns the session

### 3. Fire-and-forget threading model

- Outbound message → top-level post in channel → no thread-to-session mapping stored
- User replies with `@Humr` in the resulting thread → treated as a **new inbound mention** → creates a new session
- Context from the originating session is not carried over (acceptable trade-off for simplicity)

### 4. UI rework

**Instance list (ListView):**
- New "Channels" button on each instance row opens a modal for channel config
- Modal contains existing ChannelsPanel content: enable/disable, channel ID, allowed users

**Chat view (ChatView):**
- "channels" tab removed from right sidebar entirely
- On/off toggle added to the chat header near session ID for enabling Slack posting
- Toggle greyed out with tooltip when instance has no connected channel
- Toggle applies to new messages only (not retroactive)

**Schedules panel (SchedulesPanel):**
- "Slack outbound" checkbox added to cron/heartbeat create/edit forms
- Checkbox greyed out with tooltip when instance has no connected channel

## Alternatives Considered

**Two delivery modes (MCP tool + platform capture).** Scheduled sessions would be channel-unaware — platform captures all output and delivers on completion. Rejected — requires output capture machinery and completion signaling that doesn't exist today. Single MCP tool approach is simpler and gives agents explicit control in both contexts.

**Thread-to-session mapping for outbound messages.** Outbound posts could store `threadTs → sessionId` so replies route back to the originating session. Rejected — adds complexity (mapping storage, stale session handling) and breaks session isolation.

**Conditional tool registration.** Only register `send_slack_message` when outbound is enabled. Rejected — always registering with call-time gating is simpler; no need to dynamically update tool lists.

## Consequences

**Easier:**
- Single delivery mode for all session types — less code, fewer concepts
- Interactive agents can post selectively via MCP tool
- Scheduled agents use the same tool — consistent mental model
- Channel config accessible from instance list without entering a chat

**Harder:**
- Scheduled agents must explicitly call the tool (agent prompt must include posting instructions)
- No conversational continuity between outbound posts and Slack replies (new session each time)
