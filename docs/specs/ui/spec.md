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
|   +-- .triggers/ (controller-managed)
|   +-- memory/ (daily logs from automated runs)
|   +-- repos/ (git clones)
|   +-- artifacts/ (generated reports)
|
+-- Sessions (agent-managed)
|   +-- Session 1: "Security review - Apr 1" (active)
|   +-- Session 2: "Weekly summary - Mar 31" (inactive)
|
+-- Automated Runs (heartbeat, cron)
    +-- Execute in workspace context, write results to workspace
```

**Key principles:**

- **Workspace is the source of truth.** The agent's workspace (`.config/`, `memory/`, `repos/`, `artifacts/`) is persistent. Automated runs read from and write to this workspace.
- **Workspace contract is harness-agnostic.** Platform-defined paths (`.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md`, `.triggers/`, `memory/`, `repos/`, `artifacts/`) are the same for every harness. Harness-specific files (e.g. `CLAUDE.md`, `.claude/`) coexist alongside them.
- **Multiple concurrent sessions.** Each session is an independent conversation. The workspace is shared across all sessions.
- **Sessions are resumable, environment is ephemeral.** The instance can be hibernated and woken. Workspace persists across hibernation. Users can resume past sessions — conversation history is preserved. Session-local state (tool installs, config changes) may be lost on restart.
- **Instance-level hibernation.** The platform hibernates instances after inactivity. Workspace persists. Scheduled tasks can wake the instance automatically.
- **Workspace is directly editable.** Users can edit workspace files directly in the Workspace tab. The agent can also modify its own workspace files programmatically.
- **Heartbeat is native.** Every instance has a heartbeat — a periodic wake-up where the agent reads `.config/heartbeat.md` and acts (or skips if blank). Interval is per-instance configurable; template sets the default.

**Session types:**

| Session type | Context | Writes to workspace? | Visible in UI |
|---|---|---|---|
| Heartbeat run | Workspace | Yes (daily logs, findings) | Overview > Activity Feed |
| Cron job | Workspace | Yes (reports, updates) | Overview > Activity Feed |
| User chat | Per-session | Via agent only | Chat tab + sidebar |

## Information Architecture

Left sidebar navigation. Shared header with global search and notifications bell (unread count).

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
- **Sessions section.** Scrollable list of sessions. Each item: session name, date, status dot. Selected: highlighted + left accent border. Clicking switches the Chat tab to that session.
- **Workspace section.** Collapsible file tree. Platform paths pinned at top: `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md`. Folders: `memory/`, `repos/`, `artifacts/`. Clicking a file navigates to the Workspace tab.
- **Quick nav icons.** Home, Catalog as 2 compact icons.
- **User profile.** User icon + name.

## Instance States (PoC)

Three states, no transitional states for PoC:

| State | Indicator | Description |
|---|---|---|
| Running | Green dot | Instance is active, accepting chat, executing schedules |
| Hibernated | Gray dot | Instance is paused, workspace persists, no execution |
| Error | Red dot | Instance encountered a fatal error |

## Permission Model (PoC)

Two-layer permission system:

1. **Platform-level policies.** Configured per template (defaults) and per instance (overrides). Auto-approve or auto-deny certain permission types before they reach the user.
2. **User-level decisions.** Anything not covered by policy surfaces as an inline permission card in chat for manual approve/deny.

The Permissions tab on Agent Overview is where users view and edit instance-level policy overrides and see the audit log of past decisions.

## Stories

Detailed screen specs, interactions, states, and acceptance criteria:

| # | Story | Screens | Description |
|---|-------|---------|-------------|
| 01 | [Agent Catalog](stories/01-agent-catalog.md) | Home, Catalog | Browse agents, platform health, search and filter |
| 02 | [Agent Overview](stories/02-agent-overview.md) | Detail header, Overview tab | Health, activity feed, next scheduled runs |
| 03 | [Chat](stories/03-chat.md) | Chat tab | Converse with agent, inline permissions, clickable file paths |
| 04 | [Workspace](stories/04-workspace.md) | Workspace tab | Browse and edit agent workspace files |
| 05 | [Schedules](stories/05-schedules.md) | Schedules tab | Manage heartbeat interval and cron schedules |
| 06 | [Logs](stories/06-logs.md) | Logs tab | Agent stdout/stderr and platform event viewer |
| 07 | [Permissions](stories/07-permissions.md) | Chat tab (inline card), Permissions tab | Two-layer permission policies and inline approval |
| 08 | [Session Lifecycle](stories/08-session-lifecycle.md) | Sidebar, Chat tab | List and switch between sessions |
| 09 | [Debug Mode](stories/09-debug-mode.md) | Chat tab (footer) | ACP message log, token usage per message |
| 10 | [Deploy Agent](stories/10-deploy-agent.md) | End-to-end flow | Create agent via simple form, configure workspace, set schedules, wake |

## Cross-Cutting Concerns

**Notifications.** Bell icon in header. Types: permission request (urgent), schedule failure (warning), agent error (error). Unread count badge. Clicking opens dropdown with recent notifications; "View All" links to full list (deferred).

**Global search.** Search bar in header. Searches agent names and descriptions. Full-text search across workspace files is deferred.

**Empty states.** Every screen and section has a designed empty state with clear messaging and a CTA where applicable. No blank screens.

**Error handling.** Platform-level errors show a banner at the top of the page. Agent-level errors show inline on the relevant card or tab. Errors always include a human-readable message and a path to resolution.

**Responsive behavior.** Desktop primary (1280px+). No mobile support initially.

---

## Post-PoC Features

Features designed but deferred from PoC scope. These are validated ideas ready for implementation once the PoC foundation is stable.

### Instance Metadata

- **Owner** field on instances (creator name, filterable in catalog)
- **Tags** — user-assigned labels for categorization and filtering
- **Created date** visible on overview

### Key Metrics

Stat cards on Agent Overview: invocations (24h / 7d / 30d), avg response time, error rate, uptime counter. Click metric to navigate to Logs with relevant filter.

### Semantic Workspace Views

- `memory/` rendered as a timeline view
- `soul.md` with a dedicated identity editor
- Harness-aware file highlighting based on template's harness type

### Context Linking

"Ask about this" action on activity feed items. Opens Chat tab with pre-filled context: "Re: [activity summary] from [timestamp]". Agent reads workspace to provide context about the referenced event.

### Full Session Management

- "+" button to create new sessions
- Auto-naming from first agent response
- Right-click context menu: Rename, Archive, Delete
- "Show archived" toggle
- Resumed session dividers and environment reset banners

### Rich Debug Mode

- Latency metrics (total + time-to-first-token)
- Tool call breakdown with name, duration, status
- Model identifier
- Cost tracking per message and per session

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

- **Creation Wizard:** Guided multi-step agent creation flow.
- **Import Agent:** Import agent configuration from external source.
- **Platform Settings:** Global integrations, credential management, platform defaults.
- **Execution Environment:** Per-agent environment configuration.
- **Build Progress:** Real-time build/deploy status.
- **Audit Trail UI:** Platform-level audit log.
- **Template Editor UI:** Visual template management.
