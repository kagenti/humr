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
| Session indicator (left) | Current session name |
| System messages toggle (right) | Eye icon. Toggles visibility of tool calls and system events. Off by default (clean view). |
| Debug toggle (right) | Bug icon. Toggles debug info on agent messages (see [09-debug-mode](09-debug-mode.md)). |

### Message types

| Type | Rendering |
|------|-----------|
| User message | Right-aligned bubble, text + optional file attachments |
| Agent response | Left-aligned bubble, markdown rendered, code blocks with copy button. File paths rendered as clickable links that navigate to the Workspace tab. |
| Agent artifact | Expandable card (report, summary, file) with download action |
| System event | Centered, muted text. Hidden by default with toggle. |
| Permission request | Full-width highlighted card (see [07-permissions](07-permissions.md)) |

### Clickable file paths

When the agent references workspace files in its responses, file paths are rendered as clickable links. Clicking a path navigates to the Workspace tab with that file opened in the editor.

## Interactions

- Send message (Enter or click Send)
- Upload file (paperclip icon)
- Download artifact from agent response
- Toggle system message visibility (eye icon)
- Toggle debug mode (bug icon)
- Click file path in agent response -> opens in Workspace tab

## States

- **No conversation:** "Start a conversation with [Agent Name]." Suggested prompts based on agent description.
- **Active:** Messages flowing. Current session highlighted in sidebar.
- **Agent processing:** Typing indicator with elapsed time.
- **Agent error:** Error message in chat with retry option.
- **Instance hibernated:** Chat shows "This agent is hibernated. Wake it to continue." with Wake button.

## Scenario: Chat with Running Agent

1. Open Agent Detail > Chat tab. See suggested prompts.
2. Type: "What were the most critical findings from last week?"
3. Agent responds from accumulated memory: lists top 3 findings with severity, file locations, and status.
4. Type: "Create a summary report for the security team"
5. Agent generates artifact: report card appears in chat with "Download PDF" action.
6. Click download.

## Acceptance Criteria

- [ ] Chat displays message list with user and agent messages in bubble format
- [ ] Markdown rendering works in agent responses (headers, lists, code blocks with copy)
- [ ] Agent artifacts render as expandable cards with download action
- [ ] File upload via paperclip icon attaches files to the message
- [ ] System events are hidden by default, toggleable via eye icon
- [ ] File paths in agent responses are clickable and navigate to Workspace tab
- [ ] Session indicator in toolbar shows current session name
- [ ] Typing indicator with elapsed time shows during agent processing
- [ ] Error messages display with retry option
- [ ] Hibernated state shows wake prompt
- [ ] Suggested prompts display when no conversation exists
