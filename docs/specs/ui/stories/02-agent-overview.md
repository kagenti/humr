# Agent Overview

**As a** user, **I want to** see an agent's health, metadata, metrics, and recent activity at a glance **so that** I can assess its state and quickly investigate issues.

## Screen(s)

- S-03: Agent Detail (header)
- S-03a: Overview Tab

## Agent Detail Header (persistent across all tabs)

| Element | Description |
|---------|-------------|
| Agent name | Editable inline (edit icon) |
| Harness badge | "Claude Code", "Custom", etc. |
| Status indicator | Running/hibernated/error with uptime counter |
| Quick actions | Wake/Hibernate, Restart |
| Tab bar | Overview, Chat, Workspace, Schedules, Logs |

## Overview Layout

Two columns. Left: description and metadata. Right: metrics and activity.

### Left column

| Field | Description |
|-------|-------------|
| Description | Multi-line, editable inline |
| Owner | Creator name |
| Created | Date |
| Harness | Type + version |
| Tags | Editable inline |

### Right column

| Section | Data |
|---------|------|
| Key Metrics (stat cards) | Invocations (24h / 7d / 30d), avg response time, error rate |
| Next Scheduled Runs | Next 3 upcoming (time, type: heartbeat/cron, prompt preview) |
| Recent Activity | Last 10 events: schedule runs, permission requests, errors, findings. Each: timestamp, event type icon, one-line summary, **"Ask about this" action** (message-circle icon). "View all activity" link navigates to Logs tab with filters pre-applied. |

## Interactions

- Edit agent name inline (header)
- Wake/Hibernate/Restart agent (header quick actions)
- Edit description/tags inline
- Click metric -> navigates to Logs tab with relevant filters
- **"Ask about this"** on any activity item -> opens Chat tab with pre-filled system message: "Re: [activity summary] from [timestamp]". The agent reads its workspace to provide context about the referenced event.
- "View all activity" link -> navigates to Logs tab

## States

- **New agent:** Metrics show "No data yet." Activity empty.
- **Healthy:** Green status, metrics populated.
- **Error:** Red status, most recent error highlighted at top of activity list with "View Details" link (navigates to Logs tab filtered to errors).

## Acceptance Criteria

- [ ] Agent Detail header shows name, harness badge, status with uptime, and quick actions
- [ ] Agent name is editable inline
- [ ] Wake/Hibernate/Restart actions work and update status indicator
- [ ] Tab bar navigates between Overview, Chat, Workspace, Schedules, Logs
- [ ] Overview left column shows editable description, owner, created date, harness, and tags
- [ ] Key Metrics display invocation counts, avg response time, and error rate
- [ ] Next Scheduled Runs shows next 3 upcoming runs with type and preview
- [ ] Recent Activity shows last 10 events with timestamp, type icon, and summary
- [ ] "Ask about this" on activity item opens Chat tab with context-linked message
- [ ] Clicking a metric navigates to Logs with relevant filter pre-applied
- [ ] Error state highlights the most recent error at top of activity list
