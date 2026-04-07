# Logs

**As a** user, **I want to** view agent output and platform events **so that** I can monitor agent behavior and diagnose issues.

## Screen(s)

- S-08: Logs Tab

## Log Sources

Two log sources in PoC:

| Source | Description |
|--------|-------------|
| Agent stdout/stderr | Raw output from the harness process — what you'd see in a terminal |
| Platform events | Controller actions: instance started/stopped, trigger delivered, schedule fired, permission decisions |

## Layout

### Toolbar

| Element | Description |
|---------|-------------|
| Time range | Last 1h / 6h / 24h / 7d / Custom |
| Source filter | All / Agent Output / Platform Events |
| Severity filter | All / Info / Warning / Error |
| Search | Full-text search across log entries |

### Log entry row (collapsed)

| Element | Description |
|---------|-------------|
| Timestamp | Monospace, 13px |
| Source badge | Agent (green), Platform (blue) |
| Severity icon | info (circle-i), warning (triangle-alert), error (circle-x) |
| Summary | One-line description, truncated |

### Log entry row (expanded)

Full log text (monospace, scrollable). Link to related schedule if the entry was triggered by a heartbeat or cron run.

## Interactions

- Select time range from dropdown
- Toggle source and severity filters
- Search across log entries
- Click row to expand/collapse
- Click related schedule link to navigate

## States

- **Empty:** "No logs yet. Logs appear after the agent's first run."
- **Normal:** Entries listed newest-first.
- **Error highlight:** Error entries get a subtle red left border.

## Acceptance Criteria

- [ ] Log entries display with timestamp, source badge, severity icon, and summary
- [ ] Time range filter limits entries to selected period
- [ ] Source filter narrows to Agent Output / Platform Events
- [ ] Severity filter narrows to Info / Warning / Error
- [ ] Full-text search filters entries matching query
- [ ] Clicking a row expands to show full log text
- [ ] Expanded rows link to related schedule when applicable
- [ ] Error entries have red left border
- [ ] Empty state shows appropriate message
- [ ] Logs from Overview "View all activity" link open with pre-applied filters
