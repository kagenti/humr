# Schedules

**As a** user, **I want to** manage the agent's heartbeat interval and create cron schedules **so that** the agent can run tasks autonomously.

## Screen(s)

- S-06a: Schedules Tab

## Heartbeat vs Cron

Every instance has a native heartbeat. Cron schedules are optional. An instance can have one heartbeat + N cron schedules.

| | Heartbeat | Cron |
|---|---|---|
| **Nature** | Native to every instance | Optional, user-created |
| **Purpose** | Periodic autonomous wake-up | Run a specific task on a fixed schedule |
| **Prompt** | Reads `.config/heartbeat.md` — agent decides what to do. If blank, the run is skipped. | User-defined prompt (explicit task) |
| **Schedule** | Interval (every N minutes/hours), per-instance configurable (template sets default) | Cron expression ("0 9 * * 1" = Monday 9am) |
| **Example** | Agent wakes every 30 min, reads heartbeat.md: "Check for new commits, review for security issues, log findings" | "Generate weekly security summary from this week's findings" |

## Layout

### Heartbeat section (top)

Always visible, not a table row. Card-style layout:

| Element | Description |
|---------|-------------|
| Label | "Heartbeat" with heartbeat icon |
| Interval | Editable: number input + unit dropdown (minutes/hours). Shows template default as placeholder. |
| Status | Next run timestamp + last run timestamp with status badge (success/failed/skipped) |
| Enabled | Toggle switch |
| Link | "Edit heartbeat.md" link -> opens Workspace tab with `.config/heartbeat.md` |

### Cron schedule table (below)

| Column | Description |
|--------|-------------|
| Name | Schedule display name |
| Schedule | Cron expression with human-readable preview |
| Task | User-defined prompt (truncated) |
| Next run | Timestamp |
| Last run | Timestamp + status badge (success/failed/skipped) |
| Enabled | Toggle switch |

## Interactions

- **Edit heartbeat interval** inline (number + unit)
- **Edit heartbeat.md** link -> navigates to Workspace tab
- **Add Cron Schedule** button -> Modal: name, cron expression input with human-readable preview, prompt textarea, timezone selector
- **Edit** (click cron row) -> Same modal, pre-filled
- **Test Run** button (per schedule, including heartbeat) -> Triggers immediately, shows result in activity
- **Delete** cron schedule with confirmation (heartbeat cannot be deleted, only disabled)

## States

- **No cron schedules:** Heartbeat section always visible. Cron table shows: "No cron schedules. Add one to run specific tasks on a fixed schedule."
- **Schedule failed:** Last run shows red badge. Click for error details (navigates to Logs tab filtered to this schedule).

## Scenario: Configure Heartbeat and Add Cron

1. Schedules tab loads. Heartbeat section shows interval inherited from template (e.g. 30 min). heartbeat.md link is visible.
2. Click "Edit heartbeat.md" to write instructions in Workspace tab.
3. Return to Schedules. Click "Add Cron Schedule". Enter name: "Weekly Summary", expression: "0 9 * * 1" (preview: "Every Monday at 9:00 AM"), prompt: "Generate weekly security summary from this week's findings." Confirm.
4. Cron schedule appears in the table with next run timestamp.

## Scenario: Debug Failing Schedule

1. Home shows agent card with red error indicator.
2. Navigate to Agent Detail > Schedules. Last run shows red "failed" badge.
3. Click for error: "GitHub API returned 403 Forbidden".
4. Fix credentials, return to Schedules, click "Test Run."
5. Test run succeeds, status turns green.

## Acceptance Criteria

- [ ] Heartbeat section is always visible with interval, status, toggle, and heartbeat.md link
- [ ] Heartbeat interval is editable with number input and unit dropdown
- [ ] Heartbeat shows template default as placeholder
- [ ] Heartbeat can be enabled/disabled but not deleted
- [ ] "Edit heartbeat.md" navigates to Workspace tab
- [ ] Cron schedule table displays all cron schedules with name, schedule, task, next/last run, enabled toggle
- [ ] Add Cron Schedule modal allows creating schedules with name, expression, human-readable preview, prompt, and timezone
- [ ] Cron expression input shows human-readable preview (e.g., "Every Monday at 9:00 AM")
- [ ] Edit opens pre-filled modal for existing cron schedule
- [ ] Test Run triggers schedule immediately and shows result
- [ ] Delete cron schedule requires confirmation
- [ ] Enabled toggle switches schedule on/off
- [ ] Failed schedule shows red badge with clickable error details
- [ ] Empty cron table shows appropriate message with CTA
