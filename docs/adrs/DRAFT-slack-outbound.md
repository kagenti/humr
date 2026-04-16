# ADR-DRAFT: Slack outbound messaging — per-session MCP tool for proactive channel posting

**Date:** 2026-04-16
**Status:** Proposed
**Owner:** @tomkis

## Context

ADR-018 established Slack integration as inbound-only: users mention `@Humr` in Slack, messages route to agent instances, responses flow back in-thread. Agents have no way to initiate messages to Slack.

Agents need to post proactively — scheduled job results, status updates, and other agent-initiated communication. The current channel configuration UI (a tab inside ChatView) also needs rework since channel config is an instance-level concern, not something configured mid-chat.

## Decision

### 1. `send_slack_message` MCP tool in agent runtime

A single MCP tool exposed to the harness:

```
send_slack_message(text: string) → { ok: true } | { error: string }
```

Flow: harness → MCP tool → agent runtime → **new tRPC route** on API Server → SlackWorker → Slack.

- Posts as a **top-level message** in the instance's connected Slack channel
- Each invocation = one top-level message (no grouping or threading)
- Tool is **only registered** when outbound is enabled for the session; hidden otherwise
- Returns errors from Slack (bot removed, invalid channel) — harness is responsible for handling

### 2. Per-session outbound flag

Outbound is opt-in per session, not per instance:

- **Instance channel config** = inbound direction (existing, always on when connected)
- **Session outbound flag** = enables the MCP tool for that specific session
- Flag **persisted in DB** (survives page refresh)
- Scheduled/headless sessions: deferred — will be addressed when scheduled sessions become headful

### 3. Fire-and-forget threading model

Outbound messages have no thread-to-session binding:

- Agent posts top-level message → no mapping stored
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

**Thread-to-session mapping for outbound messages.** Outbound posts could store `threadTs → sessionId` so replies route back to the originating session. Rejected — adds complexity (mapping storage, stale session handling) for marginal benefit. Users can continue in the UI session if they need context.

**Outbound as instance-level setting.** All sessions would inherit outbound capability. Rejected — per-session control gives users finer-grained control and avoids accidental Slack spam during exploratory sessions.

**Separate REST endpoint instead of MCP tool.** Agent runtime could expose an HTTP endpoint. Rejected — harnesses already speak MCP; adding a tool is the idiomatic integration path.

## Consequences

**Easier:**
- Agents can communicate results proactively without user polling
- Channel config is accessible from instance list without entering a chat
- Per-session opt-in prevents accidental spam

**Harder:**
- No conversational continuity between outbound posts and Slack replies (new session each time)
- Scheduled sessions cannot use outbound until they become headful
