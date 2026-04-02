# Agent Catalog & Home

**As a** user, **I want to** browse all agents, see their status, and access platform health at a glance **so that** I can quickly find the agent I need and stay aware of issues.

## Screen(s)

- S-01: Home
- S-02: Agent Catalog

## Home Layout

| Section | Data |
|---------|------|
| My Agents (card grid) | Agent name, harness badge (Claude Code / custom), status indicator (running/hibernated/error), last activity timestamp |
| Platform Health (stats row) | Running agents count, failed schedules (last 24h), pending permission requests |
| Quick Actions | Create Agent |
| Recent Activity (compact list) | Last 5 events across all agents (schedule runs, errors, permission requests) |

## Agent Catalog Layout

Search bar at top. Filter chips below (harness type, status). Grid of agent cards, switchable to list view.

### Agent Card

| Field | Description |
|-------|-------------|
| Name | Agent display name |
| Description | One-line summary |
| Harness badge | "Claude Code", "Custom", etc. |
| Status indicator | Running (green dot), hibernated (gray), error (red) |
| Last active | Relative timestamp |

## Interactions

- Click agent card -> Agent Detail
- Click "Create Agent" -> Simple creation form (name, template, description)
- Click activity item (Home) -> navigates to agent's Logs tab
- Grid/list view toggle
- Filter chips toggle to narrow catalog results

## States

### Home
- **Empty:** No agents yet. CTA: "Create your first agent."
- **Normal:** Cards populated, stats visible.
- **Error:** Platform unreachable banner at top, agent cards show last known state with staleness indicator.

### Catalog
- **Empty:** "No agents on this platform yet." CTA: "Create your first agent."
- **Filtered empty:** "No agents match your filters." Clear filters link.

## Acceptance Criteria

- [ ] Home displays all user's agents as cards with name, harness badge, status, and last activity
- [ ] Platform Health row shows running agents count, failed schedules (24h), pending permissions
- [ ] Recent Activity shows last 5 events across all agents
- [ ] Clicking an agent card navigates to Agent Detail
- [ ] Agent Catalog displays all platform agents with search and filter
- [ ] Filter chips work for harness type and status
- [ ] Grid/list view toggle works
- [ ] "Create Agent" opens a simple creation form (name, template, description)
- [ ] Empty states display appropriate messaging and CTAs
- [ ] Error state shows staleness indicator on agent cards
