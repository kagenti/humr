# Session Lifecycle

**As a** user, **I want to** list and switch between sessions **so that** I can manage multiple conversations with an agent.

## Screen(s)

- Sidebar: Sessions section (agent context mode)
- S-03b: Chat Tab

## Layout

### Sidebar Sessions Section

Scrollable list of sessions for the current agent.

- **Session item (~48px):** Session name (truncated), date, status dot (green=active, gray=inactive).
- **Selected session:** Highlighted background + left accent border.

### Session naming

- Sessions are auto-named from the date ("Apr 2").
- After the first agent response, the name updates to a short summary of the topic (agent-generated, e.g., "Security review").

## Interactions

- Click a session to load it in the Chat tab
- Active session is highlighted in sidebar

## States

- **No sessions:** Session list is empty. Chat area shows "Start a conversation with [Agent Name]." Sending the first message creates a session automatically.
- **Active session:** Green dot, highlighted in sidebar. Messages flowing in chat.
- **Inactive session:** Gray dot. Can be clicked to resume.
- **Instance hibernated:** When user tries to load a session on a hibernated instance: "This agent is hibernated. Wake it to continue." with Wake button.

## Scenario: Switch Between Sessions

1. See sidebar session list: "Security review" (green, active), "Initial setup - Mar 28" (gray).
2. Click "Initial setup - Mar 28".
3. Chat tab loads that session's conversation history.
4. Previous session becomes inactive (gray dot).

## Acceptance Criteria

- [ ] Sidebar shows list of sessions with name, date, and status dot
- [ ] Clicking a session loads its conversation in Chat tab
- [ ] Selected session shows highlighted background + left accent border
- [ ] Session auto-names from date, then updates to agent-generated summary after first response
- [ ] Sending the first message in an empty chat creates a new session automatically
- [ ] Hibernated instance shows wake prompt when loading a session
- [ ] Wake button wakes the instance and loads the requested session
