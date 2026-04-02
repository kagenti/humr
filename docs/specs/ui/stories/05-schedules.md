# Schedules

**As a** user, **I want to** create and manage scheduled agent invocations **so that** the agent can run tasks autonomously on a fixed schedule or wake up periodically to decide what to do.

## Screen(s)

- S-06a: Schedules Tab

## Cron vs Heartbeat

| | Cron | Heartbeat |
|---|---|---|
| **Purpose** | Run a specific task on a fixed schedule | Periodic autonomous wake-up |
| **Prompt** | User-defined prompt (explicit task) | Reads `.config/heartbeat.md` — agent decides what to do |
| **Schedule** | Cron expression ("0 9 * * 1" = Monday 9am) | Interval (every N minutes/hours) |
| **Example** | "Generate weekly security summary from this week's findings" | "Check for new commits, review for security issues, log findings" |

## Layout

### Schedule table

| Column | Description |
|--------|-------------|
| Name | Schedule display name |
| Type | Cron / Heartbeat |
| Schedule | Cron expression with human-readable preview, or interval |
| Task | Cron: user-defined prompt (truncated). Heartbeat: "Reads heartbeat.md" link. |
| Next run | Timestamp |
| Last run | Timestamp + status badge (success/failed/skipped) |
| Enabled | Toggle switch |

## Interactions

- **Add Schedule** button -> Modal:
  - Type selector (Cron / Heartbeat)
  - Cron: expression input with human-readable preview ("Every Monday at 9:00 AM"), prompt textarea, timezone selector
  - Heartbeat: interval input (minutes/hours dropdown), link to edit `.config/heartbeat.md` in Workspace tab. Label: "What should the agent do each heartbeat? Edit heartbeat.md - write in plain English." heartbeat.md is a natural language instruction document, not structured config.
- **Edit** (click row) -> Same modal, pre-filled
- **Test Run** button (per schedule) -> Triggers immediately, shows result in activity
- **Delete** with confirmation

## States

- **No schedules:** "This agent has no schedules. Add one to make it proactive."
- **Schedule failed:** Last run shows red badge. Click for error details (navigates to Logs tab filtered to this schedule).

## Scenario: Add Schedules During Agent Setup

1. Click "Add Schedule". Select Heartbeat, set 30-min interval. heartbeat.md is already linked. Confirm.
2. Click "Add Schedule" again. Select Cron, enter "0 9 * * 1" (Monday 9am), prompt: "Generate weekly security summary from this week's findings." Confirm.
3. Both schedules appear in the table with next run timestamps.

## Scenario: Debug Failing Schedule

1. Home shows agent card with red error indicator.
2. Navigate to Agent Detail > Schedules. Last run shows red "failed" badge.
3. Click for error: "GitHub API returned 403 Forbidden".
4. Fix credentials, return to Schedules, click "Test Run."
5. Test run succeeds, status turns green.

## Acceptance Criteria

- [ ] Schedule table displays all schedules with name, type, schedule, task, next/last run, enabled toggle
- [ ] Add Schedule modal allows creating Cron schedules with expression, preview, prompt, and timezone
- [ ] Add Schedule modal allows creating Heartbeat schedules with interval and heartbeat.md link
- [ ] Cron expression input shows human-readable preview (e.g., "Every Monday at 9:00 AM")
- [ ] Heartbeat modal links to Workspace tab for editing heartbeat.md
- [ ] Edit opens pre-filled modal for existing schedule
- [ ] Test Run triggers schedule immediately and shows result
- [ ] Delete requires confirmation before removing schedule
- [ ] Enabled toggle switches schedule on/off
- [ ] Failed schedule shows red badge with clickable error details
- [ ] Empty state shows appropriate message with CTA
