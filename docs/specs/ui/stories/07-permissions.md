# Permissions

**As a** user, **I want to** control what the agent can do through platform policies and inline approval **so that** I maintain control without leaving the conversation.

## Screen(s)

- S-03b: Chat Tab (inline permission request card)
- S-03f: Permissions Tab (policy configuration + audit log)

## Two-Layer Permission Model

1. **Platform-level policies** — configured per template (defaults) and per instance (overrides). Auto-approve or auto-deny certain permission types before they reach the user.
2. **User-level decisions** — anything not covered by policy surfaces as an inline permission card in chat.

## Inline Permission Request Card (Chat Tab)

Tool-level permission requests appear inline in the conversation when not covered by a platform policy.

- **Card container:** Full chat width (not bubble-aligned), light amber background, warning border, rounded corners, 16px padding.
- **Header row:** Shield-alert icon + "Permission Required" label (semibold) + timestamp (right-aligned).
- **Operation row:** Human-readable description of the requested action (e.g., "Write to /workspace/.config/rules.md", "Execute: npm install eslint").
- **Collapsible section:** "Details" with tool-specific context. Collapsed by default.
- **Action row:** Allow button (green/primary) + Deny button (red/danger).
- **Post-action state:** Card collapses to single line: "Allowed at 15:45" with check icon, green background. Or "Denied" with red.

## Permissions Tab Layout

### Policy table

| Column | Description |
|--------|-------------|
| Permission type | Human-readable category (e.g., "File write", "Command execution", "Network access") |
| Policy | Allow / Deny / Ask (default) |
| Source | "Template default" or "Instance override" |

- "Ask" means the permission surfaces as an inline card in chat (default behavior).
- Instance overrides are editable. Template defaults are shown but read-only (edit template to change).

### Audit log (below policy table)

Chronological list of past permission decisions:

| Column | Description |
|--------|-------------|
| Timestamp | When the decision was made |
| Permission | What was requested |
| Decision | Allowed / Denied |
| Decided by | "Policy (auto)" or "User" |

## Interactions

### Chat tab
- Click **Allow** to grant the permission. Card collapses to success state. Agent proceeds.
- Click **Deny** to reject. Card collapses to denied state. Agent receives rejection.
- Click **Details** to expand tool-specific context before deciding.

### Permissions tab
- Click policy value to cycle: Ask -> Allow -> Deny -> Ask
- Changes are saved immediately
- Template defaults are read-only (labeled "Template default")

## States

### Inline card
- **Pending:** Full card with Allow/Deny buttons visible. Waiting for user action.
- **Allowed:** Collapsed to single line: "Allowed at [time]" with check icon, green background.
- **Denied:** Collapsed to single line: "Denied at [time]" with X icon, red background.

### Permissions tab
- **No overrides:** All policies show template defaults. Message: "Using template defaults. Override any policy below to customize for this instance."
- **No audit entries:** "No permission decisions yet."

## Scenario: Handle Permission Request

1. Active conversation. Type: "Install eslint and fix all linting errors in /src"
2. Platform policy auto-allows "File read" (configured as Allow in template).
3. Agent requests "Command execution: npm install eslint". Policy is "Ask" — inline card appears.
4. Click Allow. Card collapses to "Allowed at 15:45". Agent proceeds.
5. Agent requests "File write: /workspace/repos/myapp/src/utils.ts". Policy is "Ask" — inline card appears.
6. Click Allow. Agent writes the fix.

## Scenario: Configure Policies

1. Navigate to Agent Detail > Permissions tab.
2. See policy table: "File read" = Allow (template default), "Command execution" = Ask (template default), "Network access" = Deny (template default).
3. Click "Command execution" policy -> cycle to "Allow" (becomes instance override).
4. Future command execution requests are auto-approved for this instance.

## Acceptance Criteria

### Inline cards
- [ ] Permission request card renders inline at full chat width with amber background
- [ ] Card shows shield-alert icon, "Permission Required" label, and timestamp
- [ ] Operation description is human-readable (not raw tool call)
- [ ] Details section is collapsible, collapsed by default
- [ ] Allow button grants permission and collapses card to success state
- [ ] Deny button rejects and collapses card to denied state
- [ ] Collapsed states show correct icon, color, and timestamp
- [ ] Agent resumes execution after Allow
- [ ] Agent receives rejection after Deny
- [ ] Permissions covered by platform policy do not surface as cards

### Permissions tab
- [ ] Policy table shows all permission types with current policy and source
- [ ] Instance overrides are editable by clicking the policy value
- [ ] Template defaults are shown as read-only
- [ ] Changes save immediately
- [ ] Audit log shows past decisions with timestamp, permission, decision, and decider
- [ ] Empty states show appropriate messaging
