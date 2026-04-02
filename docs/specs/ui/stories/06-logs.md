# Logs

**As a** user, **I want to** view a chronological log of all agent execution events **so that** I can monitor agent behavior, diagnose issues, and understand what the agent has been doing.

## Screen(s)

- S-08: Logs Tab

## Layout

### Toolbar

| Element | Description |
|---------|-------------|
| Time range | Last 1h / 6h / 24h / 7d / Custom |
| Type filter | All / Heartbeat / Cron / Chat / Error |
| Severity filter | All / Info / Warning / Error |
| Search | Full-text search across log entries |

### Log entry row (collapsed)

| Element | Description |
|---------|-------------|
| Timestamp | Monospace, 13px |
| Type badge | Heartbeat (purple), Cron (blue), Chat (green), Error (red) |
| Severity icon | info (circle-i), warning (triangle-alert), error (circle-x) |
| Summary | One-line description, truncated |
| Duration | If applicable |
| Token count | If applicable |

### Log entry row (expanded)

Full log text (monospace, scrollable). Link to related session (if from chat) or schedule (if from heartbeat/cron). Simple trace waterfall: horizontal bar chart showing sequential steps with durations.

## Interactions

- Select time range from dropdown
- Toggle type and severity filters
- Search across log entries
- Click row to expand/collapse
- Click related session/schedule link to navigate

## States

- **Empty:** "No logs yet. Logs appear after the agent's first run."
- **Normal:** Entries listed newest-first.
- **Error highlight:** Error entries get a subtle red left border.

## Acceptance Criteria

- [ ] Log entries display with timestamp, type badge, severity icon, summary, duration, and token count
- [ ] Time range filter limits entries to selected period
- [ ] Type filter narrows to Heartbeat / Cron / Chat / Error
- [ ] Severity filter narrows to Info / Warning / Error
- [ ] Full-text search filters entries matching query
- [ ] Clicking a row expands to show full log text and trace waterfall
- [ ] Expanded rows link to related session or schedule
- [ ] Error entries have red left border
- [ ] Empty state shows appropriate message
- [ ] Logs from Overview "View all activity" link open with pre-applied filters
