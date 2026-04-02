# Humr Platform UI Specification (PoC)

**Scope:** 7 screens covering the Code Guardian use case end-to-end (Home, Agent Catalog, Agent Detail with 5 tabs).
**Surface:** Web dashboard, desktop primary (1280px+).
**Design system:** Neutral (structure and behavior, not visual treatment).
**Derives from:** [Platform Design Spec](../2026-04-01-agent-platform-design.md) — the platform spec is the source of truth for architecture, resource model, and protocol decisions.

## Persona (PoC)

Single user with full access. Creates, configures, deploys, debugs, and interacts with agents.

## Session Model

Agents have multiple concurrent activity streams: user chats, heartbeats, cron jobs, and permission requests.

**Model: Instance-level sessions with shared workspace.**

Sessions are conversations managed by the agent. The platform relays messages. Multiple sessions can run concurrently within an instance.

```
Agent Instance: Code Guardian
+-- Workspace (persistent)
|   +-- .config/soul.md, rules.md, heartbeat.md
|   +-- memory/2026-04-01.md (daily logs from automated runs)
|
+-- Sessions (agent-managed)
|   +-- Session 1: "Security review - Apr 1" (active)
|   +-- Session 2: "Weekly summary - Mar 31" (inactive)
|   +-- Session 3: "Initial setup - Mar 28" (inactive)
|
+-- Automated Runs (heartbeat, cron)
    +-- Execute in workspace context, write results to workspace
```

**Key principles:**

- **Workspace is the source of truth.** The agent's workspace (`.config/`, `memory/`, `repos/`) is persistent. Automated runs read from and write to this workspace.
- **Multiple concurrent sessions.** Each session is an independent conversation. The workspace is shared across all sessions.
- **Sessions are resumable, environment is ephemeral.** The instance can be hibernated and woken. Workspace persists across hibernation. Users can resume past sessions — conversation history is preserved. Session-local state (tool installs, config changes) may be lost on restart.
- **Instance-level hibernation.** The platform hibernates instances after inactivity. Workspace persists. Scheduled tasks can wake the instance automatically.
- **Workspace is directly editable.** Users can edit workspace files directly in the Workspace tab. The agent can also modify its own workspace files programmatically.
- **Activity linking.** Automated run outputs appear in the Overview tab's activity feed. An "Ask about this" action opens the Chat tab with pre-filled context.

**Session types:**

| Session type | Context | Writes to workspace? | Visible in UI |
|---|---|---|---|
| Heartbeat run | Workspace | Yes (daily logs, findings) | Overview > Activity Feed |
| Cron job | Workspace | Yes (reports, updates) | Overview > Activity Feed |
| User chat | Per-session | Via agent only | Chat tab + sidebar |

## Information Architecture

Left sidebar navigation. Shared header with global search, notifications bell (unread count), and user menu.

```
Humr
+-- Home
+-- Agent Catalog
+-- Agent Detail
|   +-- Overview
|   +-- Chat
|   +-- Workspace
|   +-- Schedules
|   +-- Logs
```

## Sidebar Behavior

The sidebar has two modes depending on the current page.

**Global mode** (Home, Agent Catalog): Standard navigation with 2 items: Home (house icon), Agent Catalog (bot icon). Logo at top, user profile at bottom. Large spacer in the middle.

**Agent context mode** (any Agent Detail tab): The sidebar transforms to show agent-specific content. Layout from top to bottom:

- **Back nav.** Arrow-left icon + "All Agents" text link. Returns to Agent Catalog.
- **Agent identity.** Compact agent icon (28x28), agent name (14px semibold), status dot (green=running, red=error, gray=hibernated).
- **Sessions section.** Scrollable list of sessions. Header: "Sessions" label + "+" button. Each item: session name, date, status dot. Selected: highlighted + left accent border. Right-click: Rename, Archive, Delete.
- **Workspace section.** Collapsible file tree. Files: `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md`. Folders: `memory/`. Clicking a file navigates to the Workspace tab.
- **Quick nav icons.** Home, Catalog as 2 compact icons.
- **User profile.** User icon + name.

## Stories

Detailed screen specs, interactions, states, and acceptance criteria:

| # | Story | Screens | Description |
|---|-------|---------|-------------|
| 01 | [Agent Catalog](stories/01-agent-catalog.md) | Home, Catalog | Browse agents, platform health, search and filter |
| 02 | [Agent Overview](stories/02-agent-overview.md) | Detail header, Overview tab | Health, metrics, activity feed, "Ask about this" |
| 03 | [Chat](stories/03-chat.md) | Chat tab | Converse with agent, context linking, artifacts |
| 04 | [Workspace](stories/04-workspace.md) | Workspace tab | Browse and edit agent workspace files |
| 05 | [Schedules](stories/05-schedules.md) | Schedules tab | Manage cron and heartbeat schedules |
| 06 | [Logs](stories/06-logs.md) | Logs tab | Chronological log viewer with filters |
| 07 | [Permissions](stories/07-permissions.md) | Chat tab (inline card) | Allow/Deny tool-level permission requests |
| 08 | [Session Lifecycle](stories/08-session-lifecycle.md) | Sidebar, Chat tab | Create, resume, rename, archive, delete sessions |
| 09 | [Debug Mode](stories/09-debug-mode.md) | Chat tab (footer) | Token usage, latency, tool calls, model info |
| 10 | [Deploy Agent](stories/10-deploy-agent.md) | End-to-end flow | Create agent, configure workspace, set schedules, wake |

## Cross-Cutting Concerns

**Notifications.** Bell icon in header. Types: permission request (urgent), schedule failure (warning), agent error (error). Unread count badge. Clicking opens dropdown with recent notifications; "View All" links to full list (deferred).

**Global search.** Search bar in header. Searches agent names, descriptions, and tags. Full-text search across workspace files is deferred.

**Empty states.** Every screen and section has a designed empty state with clear messaging and a CTA where applicable. No blank screens.

**Error handling.** Platform-level errors show a banner at the top of the page. Agent-level errors show inline on the relevant card or tab. Errors always include a human-readable message and a path to resolution.

**Responsive behavior.** Desktop primary (1280px+). No mobile support initially.

---

## Post-PoC Features

Features designed but deferred from PoC scope. These are validated ideas ready for implementation once the PoC foundation is stable.

### Multi-user RBAC

Two personas sharing the same application shell with role-based visibility:

- **Agent Developer:** Creates, configures, deploys, and debugs agents. Full access to workspace (edit), schedules (edit), logs (full), approval policies (config).
- **End User / Agent Consumer:** Interacts with running agents, approves requests, views findings. Workspace (read-only), schedules (read-only), logs (filtered to activity: findings, errors, approvals only — tab labeled "Activity" instead of "Logs").

### Approval System

**Standalone Approval Queue.** Central screen for processing all pending HiTL requests across all agents. Design requirement: process 20 requests in under 2 minutes. Includes pre-computed risk levels, keyboard shortcuts (j/k navigation, a/d approve/deny), bulk actions ("Approve All Low-Risk"), and expandable rows with agent reasoning, service-specific previews, and policy match details.

**Per-Agent Approval Policy Configuration.** Table of HiTL policies per agent (service, resource pattern, method, action). Key UX: template selector per service (e.g., GitHub "Repository Reader", "Contributor", "Full Access") that pre-populates rules for quick setup. Includes fatigue metrics panel to help tune policies.

**Service-level approval cards.** Richer inline approval cards in chat with risk badges, service icons, "Why?" and "Details" sections, and "View in Queue" link.

### Channel Mirroring

Two-way connection between a session and a Slack or Telegram channel. Messages mirror between web and channel, attributed by name. Approval cards render as native Slack blocks/Telegram cards. Tool calls and system events stay web-only.

### Additional Screens

- **Creation Wizard:** Guided agent creation flow.
- **Import Agent:** Import agent configuration from external source.
- **Platform Settings:** Global integrations, credential management, platform defaults.
- **Execution Environment:** Per-agent environment configuration.
- **Build Progress:** Real-time build/deploy status.
- **Audit Trail UI:** Platform-level audit log.
- **Template Editor UI:** Visual template management.
