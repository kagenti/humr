# ADR-DRAFT: Slack outbound messaging — two delivery modes

**Date:** 2026-04-16
**Status:** Proposed
**Owner:** @tomkis

## Context

ADR-018 established Slack integration as inbound-only: users mention `@Humr` in Slack, messages route to agent instances, responses flow back in-thread. Agents have no way to initiate messages to Slack.

Agents need to post proactively — scheduled job results, status updates, and other agent-initiated communication. The current channel configuration UI (a tab inside ChatView) also needs rework since channel config is an instance-level concern, not something configured mid-chat.

## Decision

### 1. Two delivery modes

**Interactive sessions — MCP tool (agent-driven):**

```
send_slack_message(text: string) → { ok: true } | { error: string }
```

The agent explicitly decides what and when to post. Flow: harness → MCP tool → agent runtime → new tRPC route on API Server → SlackWorker → Slack.

- Tool **only registered** when outbound is enabled for the session; hidden otherwise
- Returns errors from Slack (bot removed, invalid channel) — harness handles

**Scheduled sessions — platform delivery (infra-driven):**

The platform captures all agent output from a scheduled job run and delivers it to the instance's connected Slack channel. The agent is channel-unaware — it just produces output, the platform routes it. Similar to OpenClaw's cron delivery model.

- Delivery happens when the scheduled session completes
- Posts as a top-level message in the connected channel
- Enabled per schedule via flag in schedule definition (cron/heartbeat config)
- Toggle greyed out with tooltip when instance has no connected channel

### 2. Per-session outbound flag (interactive only)

For interactive sessions, outbound is opt-in per session:

- **Instance channel config** = inbound direction (existing, always on when connected)
- **Session outbound flag** = enables the `send_slack_message` MCP tool for that specific session
- Flag **persisted in DB** (survives page refresh)

### 3. Fire-and-forget threading model

Both delivery modes use the same threading model:

- Outbound message → top-level post in channel → no thread-to-session mapping stored
- User replies with `@Humr` in the resulting thread → treated as a **new inbound mention** → creates a new session
- Context from the originating session is not carried over (acceptable trade-off for simplicity)

### 4. UI rework

**Instance list (ListView):**
- Dedicated button on each instance row opens a modal for channel config
- Modal contains existing ChannelsPanel content: enable/disable, channel ID, allowed users

**Chat view (ChatView):**
- "channels" tab removed from right sidebar entirely
- "Enable Posting to Slack" toggle added to the chat header near session ID
- Toggle greyed out with tooltip when instance has no connected channel
- Toggle applies to new messages only (not retroactive)

## Alternatives Considered

**Thread-to-session mapping for outbound messages.** Outbound posts could store `threadTs → sessionId` so replies route back to the originating session. Rejected — adds complexity (mapping storage, stale session handling) and breaks session isolation. OpenClaw uses the same fire-and-forget model.

**MCP tool for scheduled sessions too.** Agent would call `send_slack_message` explicitly in scheduled runs. Rejected — scheduled jobs should be channel-unaware; the platform decides where output goes. Separating concerns avoids coupling agent prompts to delivery targets.

**Platform delivery for interactive sessions too.** Mirror all session output to Slack. Rejected — interactive sessions are multi-turn and noisy; mirroring everything would spam the channel. Explicit tool gives the agent control over what's worth posting.

## Consequences

**Easier:**
- Scheduled jobs deliver results without agent awareness of Slack
- Interactive agents can post selectively via MCP tool
- Channel config accessible from instance list without entering a chat

**Harder:**
- Two delivery modes to implement and maintain
- No conversational continuity between outbound posts and Slack replies (new session each time)
