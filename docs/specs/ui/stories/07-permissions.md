# Inline Permission Requests

**As a** user, **I want to** approve or deny tool-level permission requests inline in the chat **so that** I maintain control over what the agent can do without leaving the conversation.

## Screen(s)

- S-03b: Chat Tab (permission request card)

## Layout

### Inline permission request card

Tool-level permission requests appear inline in the conversation. This is the PoC mechanism for human-in-the-loop approval.

- **Card container:** Full chat width (not bubble-aligned), light amber background, warning border, rounded corners, 16px padding.
- **Header row:** Shield-alert icon + "Permission Required" label (semibold) + timestamp (right-aligned).
- **Operation row:** Human-readable description of the requested action (e.g., "Write to /workspace/.config/rules.md", "Execute: npm install eslint").
- **Collapsible section:** "Details" with tool-specific context. Collapsed by default.
- **Action row:** Allow button (green/primary) + Deny button (red/danger).
- **Post-action state:** Card collapses to single line: "Allowed at 15:45" with check icon, green background. Or "Denied" with red.

## Interactions

- Click **Allow** to grant the permission. Card collapses to success state. Agent proceeds.
- Click **Deny** to reject. Card collapses to denied state. Agent receives rejection.
- Click **Details** to expand tool-specific context before deciding.

## States

- **Pending:** Full card with Allow/Deny buttons visible. Waiting for user action.
- **Allowed:** Collapsed to single line: "Allowed at [time]" with check icon, green background.
- **Denied:** Collapsed to single line: "Denied at [time]" with X icon, red background.

## Scenario: Handle Permission Request

1. Active conversation. Type: "Install eslint and fix all linting errors in /src"
2. Agent requests permission. Inline card appears: "Permission Required - Execute: npm install eslint"
3. Click Allow. Card collapses to "Allowed at 15:45". Agent proceeds.
4. Agent requests another permission: "Write to /workspace/repos/myapp/src/utils.ts"
5. Click Allow. Agent writes the fix.

## Acceptance Criteria

- [ ] Permission request card renders inline at full chat width with amber background
- [ ] Card shows shield-alert icon, "Permission Required" label, and timestamp
- [ ] Operation description is human-readable (not raw tool call)
- [ ] Details section is collapsible, collapsed by default
- [ ] Allow button grants permission and collapses card to success state
- [ ] Deny button rejects and collapses card to denied state
- [ ] Collapsed states show correct icon, color, and timestamp
- [ ] Agent resumes execution after Allow
- [ ] Agent receives rejection after Deny
- [ ] Multiple sequential permission requests each render as separate cards
