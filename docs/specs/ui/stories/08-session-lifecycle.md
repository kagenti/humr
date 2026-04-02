# Session Lifecycle

**As a** user, **I want to** create, resume, rename, archive, and delete sessions **so that** I can organize my conversations with an agent and pick up where I left off.

## Screen(s)

- Sidebar: Sessions section (agent context mode)
- S-03b: Chat Tab (resumed session state)

## Layout

### Sidebar Sessions Section

Scrollable list of sessions for the current agent.

- **Header:** "Sessions" label + "+" button (creates new session).
- **Session item (~48px):** Session name (truncated), date, status dot (green=active, gray=inactive).
- **Selected session:** Highlighted background + left accent border.
- **Context menu (right-click):** Rename, Archive, Delete.

### Session naming

- New sessions auto-named from the date ("Apr 2").
- After the first agent response, the name updates to a short summary of the topic (agent-generated, e.g., "Security review").
- Users can rename sessions manually via right-click > Rename.

### Session management

- **Archive:** Hidden from default list, accessible via "Show archived" toggle at bottom of session list.
- **Delete:** Permanently removes conversation history, confirmation required.

## Interactions

- Click "+" to create a new session
- Click a session to load it in the Chat tab
- Right-click session for context menu: Rename, Archive, Delete
- Toggle "Show archived" to reveal archived sessions

## States

- **No sessions:** Session list is empty. Chat area shows "Start a conversation with [Agent Name]."
- **Active session:** Green dot, highlighted in sidebar. Messages flowing in chat.
- **Inactive session:** Gray dot. Can be clicked to resume.
- **Resumed session:** Session history displayed with a "Resumed today" divider between old and new messages. Yellow reset banner at top: "Environment reset. Workspace configs applied, but session-local changes (tool installs, config edits) may need to be reinstalled." Input bar remains active.
- **Instance hibernated:** When user tries to load a session on a hibernated instance: "This agent is hibernated. Wake it to continue." with Wake button.

## Scenario: Resume Session After Hibernation

1. See sidebar session list. Click "Initial setup - Mar 28" (gray dot, inactive).
2. If instance is hibernated: "This agent is hibernated. Wake it to continue." Click Wake.
3. Session loads with old history and reset banner.
4. See resume divider: "Resumed today" between old messages and input area.
5. Type: "Can you reinstall the eslint plugin? I see the config is gone."
6. Agent responds and re-installs the tool in the fresh environment.

## Acceptance Criteria

- [ ] "+" button creates a new session and opens it in Chat tab
- [ ] New session is auto-named from the date
- [ ] Session name updates to agent-generated summary after first response
- [ ] Clicking a session in sidebar loads its conversation in Chat tab
- [ ] Selected session shows highlighted background + left accent border
- [ ] Right-click opens context menu with Rename, Archive, Delete
- [ ] Rename allows editing the session name inline
- [ ] Archive hides session from default list
- [ ] "Show archived" toggle reveals archived sessions
- [ ] Delete requires confirmation and permanently removes conversation
- [ ] Resumed sessions show "Resumed today" divider
- [ ] Reset banner appears on resumed sessions with correct messaging
- [ ] Hibernated instance shows wake prompt when loading a session
- [ ] Wake button wakes the instance and loads the requested session
