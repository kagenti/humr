---
name: calendar-agenda
description: |
  View and manage Google Calendar events. Use when the user asks about their schedule, meetings, or calendar.
---

Manage Google Calendar using the `gws` CLI.

## Commands

**Show upcoming events:**
```bash
gws calendar +agenda
```

**Create an event:**
```bash
gws calendar +insert --summary "Meeting Title" --start "2026-06-15T10:00:00" --end "2026-06-15T11:00:00"
```

## Cross-service Workflows

**Daily standup summary (meetings + tasks):**
```bash
gws workflow +standup-report
```

**Prepare for next meeting (agenda, attendees, linked docs):**
```bash
gws workflow +meeting-prep
```

**Weekly digest (meetings + unread email count):**
```bash
gws workflow +weekly-digest
```
