# Schedule Tasks

Agents can run on a schedule — no laptop required. The scheduler runs on the platform, so tasks fire whether your browser is open or not.

## Create a schedule

1. Open an instance and go to the **Schedules** tab.
2. Pick a **frequency** — every few minutes, hourly, daily at a specific time, or a custom recurrence rule.
3. Choose which **days** the schedule should run.
4. Set the **message** the agent receives when the schedule fires.
5. Optionally set a **timezone** and **quiet hours** to pause the schedule overnight or during off-hours.

When a schedule fires, the agent receives the message exactly as if you typed it. No special logic needed.

## Frequency options

| Frequency | Example |
|---|---|
| **Every N minutes** | Every 30 minutes, weekdays only |
| **Every N hours** | Every 2 hours |
| **Daily** | Weekdays at 9:00am |
| **Custom** | Any RFC 5545 recurrence rule |

## Quiet hours

Quiet hours let you pause a schedule during specific time windows — for example, suppress overnight runs between 10pm and 6am. When a scheduled fire falls inside a quiet-hours window, it's silently skipped. You can add multiple windows and toggle each one independently.

## Session mode

Each schedule can run in one of two modes:

- **Fresh session** — every fire starts a new conversation. Good for independent tasks like daily reports.
- **Continuous session** — fires resume the same conversation. Good for ongoing work where the agent builds on previous context.

## Persistent context

The home directory persists across schedule fires. An agent running daily can reference what it found yesterday — files, notes, git history — without starting from scratch.

## Example use cases

- **Morning brief** — scan Slack and GitHub at 7am, DM a summary.
- **Code review bot** — check for new PRs every hour, post review comments.
- **Docs guardian** — check for README drift weekly, propose edits.
- **Heartbeat** — run a health check every 30 minutes, alert if something's off.
