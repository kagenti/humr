# Deploy Agent (End-to-End)

**As a** user, **I want to** create a new agent, configure its workspace, set up schedules, and start it **so that** the agent begins running autonomously.

## Screen(s)

- S-01: Home
- S-03a: Overview Tab
- S-03c: Workspace Tab
- S-06a: Schedules Tab

This is a cross-cutting flow that validates the integration between multiple stories: [02-agent-overview](02-agent-overview.md), [04-workspace](04-workspace.md), [05-schedules](05-schedules.md).

## Scenario: Deploy Code Guardian

1. **Home:** Click "Create Agent".
2. **Creation flow (deferred):** Select Claude Code harness, provide repo, name "Code Guardian", configure basics.
3. **Agent Detail > Overview:** Agent created, status "hibernated".
4. **Agent Detail > Workspace:** Write `.config/soul.md` (agent identity: "I am a security-focused code review agent..."), `.config/rules.md` (operating rules: "Flag issues but never auto-merge..."), `.config/heartbeat.md` (plain English: "Check for new commits, review for security issues...")
5. **Agent Detail > Schedules:** Click "Add Schedule". Select Heartbeat, set 30-min interval. The heartbeat.md written in step 4 is already linked. Confirm.
6. **Agent Detail > Schedules:** Add second schedule: Cron, "0 9 * * 1" (Monday 9am), prompt: "Generate weekly security summary from this week's findings."
7. **Agent Detail header:** Click "Wake". Agent begins first heartbeat cycle.

## Acceptance Criteria

- [ ] "Create Agent" on Home initiates creation flow
- [ ] New agent appears in Agent Detail with "hibernated" status
- [ ] User can write `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md` via Workspace tab
- [ ] User can create a Heartbeat schedule with interval
- [ ] User can create a Cron schedule with expression and prompt
- [ ] Both schedules appear in the Schedules table after creation
- [ ] "Wake" action in header starts the agent
- [ ] Agent transitions from "hibernated" to "running" status
- [ ] First heartbeat executes within the configured interval
- [ ] Agent activity appears in Overview > Recent Activity after first run
