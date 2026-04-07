# Deploy Agent (End-to-End)

**As a** user, **I want to** create a new agent, configure its workspace, set up schedules, and start it **so that** the agent begins running autonomously.

## Screen(s)

- S-01: Home / Agent Catalog
- S-03a: Overview Tab
- S-03c: Workspace Tab
- S-06a: Schedules Tab

This is a cross-cutting flow that validates the integration between multiple stories: [01-agent-catalog](01-agent-catalog.md), [02-agent-overview](02-agent-overview.md), [04-workspace](04-workspace.md), [05-schedules](05-schedules.md).

## Creation Form

Simple form (not a multi-step wizard). Fields:

| Field | Description |
|-------|-------------|
| Name | Agent display name (required) |
| Template | Select from available templates (required) |
| Description | One-line summary (optional) |

Submitting creates the instance in "hibernated" state and navigates to Agent Detail > Overview.

## Scenario: Deploy Code Guardian

1. **Agent Catalog:** Click "Create Agent". Simple form appears.
2. **Form:** Select "Claude Code" template, name "Code Guardian", description "Security-focused code review agent". Submit.
3. **Agent Detail > Overview:** Agent created, status "hibernated".
4. **Agent Detail > Workspace:** Write `.config/soul.md` (agent identity: "I am a security-focused code review agent..."), `.config/rules.md` (operating rules: "Flag issues but never auto-merge..."), `.config/heartbeat.md` (plain English: "Check for new commits, review for security issues...")
5. **Agent Detail > Schedules:** Heartbeat section shows 30-min interval (template default). Adjust if needed. Click "Edit heartbeat.md" to verify instructions.
6. **Agent Detail > Schedules:** Click "Add Cron Schedule". Name: "Weekly Summary", expression: "0 9 * * 1" (Monday 9am), prompt: "Generate weekly security summary from this week's findings." Confirm.
7. **Agent Detail header:** Click "Wake". Agent begins first heartbeat cycle.

## Acceptance Criteria

- [ ] "Create Agent" opens a simple form with name, template, and description fields
- [ ] Template field shows available templates as a select dropdown
- [ ] Submitting the form creates the instance in "hibernated" state
- [ ] After creation, user is navigated to Agent Detail > Overview
- [ ] User can write `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md` via Workspace tab
- [ ] Heartbeat section in Schedules shows template default interval
- [ ] User can adjust heartbeat interval
- [ ] User can create a Cron schedule with name, expression, and prompt
- [ ] Both heartbeat and cron schedule appear in the Schedules tab
- [ ] "Wake" action in header starts the agent
- [ ] Agent transitions from "hibernated" to "running" status
- [ ] First heartbeat executes within the configured interval
- [ ] Agent activity appears in Overview > Recent Activity after first run
