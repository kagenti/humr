# Chat

**As a** user, **I want to** converse with an agent in a chat interface **so that** I can ask questions, get findings, generate reports, and interact with the agent's accumulated knowledge.

## Screen(s)

- S-03b: Chat Tab

## Layout

Chat toolbar at top, message list (scrollable, newest at bottom), input bar at bottom with send button and file upload. Session selection happens via the sidebar (see spec.md Sidebar Behavior), not in the chat area.

### Chat toolbar

Thin bar at the top of the chat area:

| Element | Description |
|---------|-------------|
| Context link (left) | When opened via "Ask about this": link icon + "Re: [activity summary] from [timestamp]". Otherwise empty. |
| System messages toggle (right) | Eye icon. Toggles visibility of tool calls and system events. Off by default (clean view). |
| Debug toggle (right) | Bug icon. Toggles debug info on agent messages (see [09-debug-mode](09-debug-mode.md)). |

### Message types

| Type | Rendering |
|------|-----------|
| User message | Right-aligned bubble, text + optional file attachments |
| Agent response | Left-aligned bubble, markdown rendered, code blocks with copy button |
| Agent artifact | Expandable card (report, summary, file) with download action |
| System event | Centered, muted text. Hidden by default with toggle. |
| Permission request | Full-width highlighted card (see [07-permissions](07-permissions.md)) |

### Context linking

When opened via "Ask about this" from the Overview tab, the chat toolbar shows a context link and the agent responds with context from its workspace about the referenced event. The user can then ask follow-up questions naturally.

## Interactions

- Send message (Enter or click Send)
- Upload file (paperclip icon)
- Download artifact from agent response
- Toggle system message visibility (eye icon)
- Toggle debug mode (bug icon)

## States

- **No conversation:** "Start a conversation with [Agent Name]." Suggested prompts based on agent description.
- **Active:** Messages flowing. Current session highlighted in sidebar.
- **Agent processing:** Typing indicator with elapsed time.
- **Agent error:** Error message in chat with retry option.
- **Context-linked:** Opened from "Ask about this". Context link visible in chat toolbar. Agent responds with workspace context.
- **Instance hibernated:** Chat shows "This agent is hibernated. Wake it to continue." with Wake button.

## Scenario: Chat with Running Agent

1. Open Agent Detail > Chat tab. See suggested prompts.
2. Type: "What were the most critical findings from last week?"
3. Agent responds from accumulated memory: lists top 3 findings with severity, file locations, and status.
4. Type: "Create a summary report for the security team"
5. Agent generates artifact: report card appears in chat with "Download PDF" action.
6. Click download.

## Scenario: Investigate a Finding via Activity Link

1. From Overview tab, see activity item: "Heartbeat found SQL injection in /api/users"
2. Click "Ask about this" on the activity item.
3. Chat tab opens with context link: "Re: SQL injection finding from heartbeat at 15:30"
4. Agent responds with full context from workspace: severity, exact code location, commit hash, recommended fix.
5. Ask follow-up: "Is this related to the XSS issue you found last week?"
6. Agent cross-references daily memory logs and provides context.

## Acceptance Criteria

- [ ] Chat displays message list with user and agent messages in bubble format
- [ ] Markdown rendering works in agent responses (headers, lists, code blocks with copy)
- [ ] Agent artifacts render as expandable cards with download action
- [ ] File upload via paperclip icon attaches files to the message
- [ ] System events are hidden by default, toggleable via eye icon
- [ ] Context link appears in toolbar when opened via "Ask about this"
- [ ] Typing indicator with elapsed time shows during agent processing
- [ ] Error messages display with retry option
- [ ] Hibernated state shows wake prompt
- [ ] Suggested prompts display when no conversation exists
