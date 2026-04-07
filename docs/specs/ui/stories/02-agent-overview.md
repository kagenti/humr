# Agent Overview

**As a** user, **I want to** see an agent's health, description, and recent activity at a glance **so that** I can assess its state and quickly investigate issues.

## Screen(s)

- S-03: Agent Detail (header)
- S-03a: Overview Tab

## Agent Detail Header (persistent across all tabs)

| Element | Description |
|---------|-------------|
| Agent name | Editable inline (edit icon) |
| Harness badge | "Claude Code", "Custom", etc. |
| Status indicator | Running (green) / Hibernated (gray) / Error (red) |
| Quick actions | Wake / Hibernate |
| Tab bar | Overview, Chat, Workspace, Schedules, Logs |

## Overview Layout

Two columns. Left: description. Right: scheduled runs and activity.

### Left column

| Field | Description |
|-------|-------------|
| Description | Multi-line, editable inline |
| Harness | Type |
| Template | Source template name |

### Right column

| Section | Data |
|---------|------|
| Next Scheduled Runs | Next 3 upcoming (time, type: heartbeat/cron, prompt preview) |
| Recent Activity | Last 10 events: schedule runs, permission requests, errors, findings. Each: timestamp, event type icon, one-line summary. "View all activity" link navigates to Logs tab with filters pre-applied. |

**Note:** Activity feed event types are TBD and will be revisited as the controller and agent runtime mature.

## Interactions

- Edit agent name inline (header)
- Wake/Hibernate agent (header quick actions)
- Edit description inline
- "View all activity" link -> navigates to Logs tab

## States

- **New agent:** Activity empty. "No activity yet."
- **Healthy:** Green status, activity populated.
- **Error:** Red status, most recent error highlighted at top of activity list with "View Details" link (navigates to Logs tab filtered to errors).

## Acceptance Criteria

- [ ] Agent Detail header shows name, harness badge, status, and quick actions
- [ ] Agent name is editable inline
- [ ] Wake/Hibernate actions work and update status indicator
- [ ] Tab bar navigates between Overview, Chat, Workspace, Schedules, Logs
- [ ] Overview left column shows editable description, harness type, and template name
- [ ] Next Scheduled Runs shows next 3 upcoming runs with type and preview
- [ ] Recent Activity shows last 10 events with timestamp, type icon, and summary
- [ ] "View all activity" navigates to Logs tab
- [ ] Error state highlights the most recent error at top of activity list
