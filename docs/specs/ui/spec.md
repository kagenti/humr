# Humr Platform UI Specification (PoC)

**Scope:** 7 screens covering the Code Guardian use case end-to-end (Home, Agent Catalog, Agent Detail with 5 tabs).
**Surface:** Web dashboard, desktop primary (1280px+).
**Design system:** Neutral (structure and behavior, not visual treatment).
**Derives from:** [Platform Design Spec](../2026-04-01-agent-platform-design.md) — the platform spec is the source of truth for architecture, resource model, and protocol decisions.

## Persona (PoC)

Single user with full access. Creates, configures, deploys, debugs, and interacts with agents.

## Session Model

Agents have multiple concurrent activity streams: user chats, heartbeats, cron jobs, and permission requests. The session model determines how these streams relate to each other and how the UI surfaces them.

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
- **Sessions are resumable, environment is ephemeral.** The instance can be hibernated and woken. Workspace persists across hibernation. Users can resume past sessions — conversation history is preserved. Session-local state (tool installs, config changes) may be lost on restart. A soft warning banner communicates this.
- **Instance-level hibernation.** The platform hibernates instances after inactivity. Workspace persists. Scheduled tasks can wake the instance automatically.
- **Workspace is directly editable.** Users can edit workspace files directly in the Workspace tab. The agent can also modify its own workspace files programmatically.
- **Activity linking.** Automated run outputs (findings, reports, errors) appear in the Overview tab's activity feed. An "Ask about this" action opens the Chat tab with pre-filled context, bridging the workspace into the user's conversation.

**Session types and their context mapping:**

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
- **Agent identity.** Compact agent icon (28x28), agent name (14px semibold), status dot (green=running, red=error, gray=hibernated). Persistent identity visible regardless of which tab is selected.
- **Sessions section.** Scrollable list of sessions for this agent. Header: "Sessions" label + "+" button (creates new session). Each session item (~48px): session name (truncated), date, status dot (green=active, gray=inactive). Selected session: highlighted background + left accent border. Clicking a session loads it in the Chat tab. Right-click a session for context menu: Rename, Archive, Delete.
  - **Session naming:** New sessions are auto-named from the date ("Apr 2"). After the first agent response, the name updates to a short summary of the topic (agent-generated, e.g., "Security review"). Users can rename sessions manually via right-click > Rename.
  - **Session management:** Sessions can be archived (hidden from default list, accessible via "Show archived" toggle at bottom) or deleted (permanently removes conversation history, confirmation required).
- **Workspace section.** Collapsible file tree showing the agent's workspace files. Expanded by default, collapsible via chevron toggle. Header: "Workspace" label + chevron. Files: `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md`. Folders: `memory/` (collapsed by default). Clicking a file navigates to the Workspace tab with that file selected.
- **Quick nav icons.** Small icon-only row: Home, Catalog as 2 compact icons. Escape hatches to global navigation without leaving the agent view.
- **User profile.** User icon + name (same as global mode).

---

## S-01: Home

**Purpose:** Landing page after login. Orients the user and surfaces what needs attention.

### Layout

| Section | Data |
|---------|------|
| My Agents (card grid) | Agent name, harness badge (Claude Code / custom), status indicator (running/hibernated/error), last activity timestamp |
| Platform Health (stats row) | Running agents count, failed schedules (last 24h), pending permission requests |
| Quick Actions | Create Agent, Import Agent |
| Recent Activity (compact list) | Last 5 events across all agents (schedule runs, errors, permission requests) |

### Interactions

- Click agent card -> Agent Detail (S-03)
- Click "Create Agent" -> Creation flow (deferred, placeholder)
- Click activity item -> navigates to agent's Logs tab

### States

- **Empty:** No agents yet. CTA: "Create your first agent."
- **Normal:** Cards populated, stats visible.
- **Error:** Platform unreachable banner at top, agent cards show last known state with staleness indicator.

---

## S-02: Agent Catalog

**Purpose:** Browse and discover all available agents on the platform.

### Layout

Search bar at top. Filter chips below (harness type, status, tags). Grid of agent cards, switchable to list view.

### Agent Card

| Field | Description |
|-------|-------------|
| Name | Agent display name |
| Description | One-line summary |
| Harness badge | "Claude Code", "Custom", etc. |
| Status indicator | Running (green dot), hibernated (gray), error (red) |
| Last active | Relative timestamp |
| Tags | User-assigned labels |
| Owner | Creator name |

### Actions

- **Create Agent** button (top right) -> Creation flow
- **Import Agent** button -> Import flow
- Click card -> Agent Detail
- Bulk actions: wake/hibernate selected agents

### States

- **Empty:** "No agents on this platform yet." CTA: "Create your first agent."
- **Filtered empty:** "No agents match your filters." Clear filters link.

---

## S-03: Agent Detail (Tabbed Container)

**Purpose:** Central hub for a single agent. All agent-specific screens live here as tabs.

### Header (persistent across tabs)

| Element | Description |
|---------|-------------|
| Agent name | Editable inline (edit icon) |
| Harness badge | "Claude Code", "Custom", etc. |
| Status indicator | Running/hibernated/error with uptime counter |
| Quick actions | Wake/Hibernate, Restart |
| Tab bar | Overview, Chat, Workspace, Schedules, Logs |

---

## S-03a: Overview Tab

**Purpose:** At-a-glance health and activity for this agent.

### Layout

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
| Recent Activity | Last 10 events: schedule runs, permission requests, errors, findings. Each: timestamp, event type icon, one-line summary, **"Ask about this" action** (message-circle icon). "View all activity" link navigates to Logs tab (S-08) with filters pre-applied. |

### Interactions

- Edit description/tags inline. Click metric for detail (navigates to Logs tab with relevant filters).
- **"Ask about this"** on any activity item opens the Chat tab with a pre-filled system message: "Re: [activity summary] from [timestamp]". The agent reads its workspace to provide context about the referenced event.

### States

- **New agent:** Metrics show "No data yet." Activity empty.
- **Healthy:** Green status, metrics populated.
- **Error:** Red status, most recent error highlighted at top of activity list with "View Details" link (navigates to Logs tab filtered to errors).

---

## S-03b: Chat Tab

**Purpose:** Conversational interface with the agent. The agent reads from its shared workspace to answer questions about findings, accumulated knowledge, and automated run results.

### Layout

Chat toolbar at top, message list (scrollable, newest at bottom), input bar at bottom with send button and file upload. Session selection happens via the sidebar (see Sidebar Behavior), not in the chat area.

### Chat toolbar

Thin bar at the top of the chat area with contextual info and actions:

| Element | Description |
|---------|-------------|
| Context link (left) | When opened via "Ask about this": link icon + "Re: [activity summary] from [timestamp]". Otherwise empty. |
| System messages toggle (right) | Eye icon. Toggles visibility of tool calls and system events in the chat. Off by default (clean view). |
| Debug toggle (right) | Bug icon. Toggles debug info on agent messages. |

### Context linking

When opened via "Ask about this" from the Overview tab, the chat toolbar shows a context link and the agent responds with context from its workspace about the referenced event. The user can then ask follow-up questions naturally.

### Message types

| Type | Rendering |
|------|-----------|
| User message | Right-aligned bubble, text + optional file attachments |
| Agent response | Left-aligned bubble, markdown rendered, code blocks with copy button |
| Agent artifact | Expandable card (report, summary, file) with download action |
| System event | Centered, muted text ("Agent requested file write access"). Hidden by default with toggle. |
| Permission request (inline) | Full-width highlighted card (see below) |

### Inline permission request card

Tool-level permission requests appear inline in the conversation. This is the PoC mechanism for human-in-the-loop approval.

- **Card container:** Full chat width (not bubble-aligned), light amber background, warning border, rounded corners, 16px padding.
- **Header row:** Shield-alert icon + "Permission Required" label (semibold) + timestamp (right-aligned).
- **Operation row:** Human-readable description of the requested action (e.g., "Write to /workspace/.config/rules.md", "Execute: npm install eslint").
- **Collapsible section:** "Details" with tool-specific context. Collapsed by default.
- **Action row:** Allow button (green/primary) + Deny button (red/danger).
- **Post-action state:** Card collapses to single line: "Allowed at 15:45" with check icon, green background. Or "Denied" with red.

### Debug mode

Toggle: bug icon in chat toolbar (top right). When active:

- Each agent response message shows a collapsible debug footer below the message content.
- **Debug footer content:** Token usage (input/output), latency (total + time-to-first-token), tool calls (name, duration, status), model identifier.
- **Styling:** `$bg-secondary` background, monospace font (12px), muted text. Separated from message content by a thin border.
- Debug info is per-message, independently expandable.

### Interactions

- Select session from sidebar (loads conversation in chat area)
- Create new session ("+" button in sidebar Sessions header)
- Send message (Enter or click Send)
- Upload file (paperclip icon)
- Download artifact
- Allow/Deny inline permission request
- Toggle debug mode (bug icon)
- Toggle system message visibility (eye icon)

### States

- **No conversation:** "Start a conversation with [Agent Name]." Suggested prompts based on agent description. Sidebar session list shows no sessions.
- **Active:** Messages flowing. Current session highlighted in sidebar.
- **Agent processing:** Typing indicator with elapsed time.
- **Agent error:** Error message in chat with retry option.
- **Resumed session:** Session history displayed with a "Resumed today" divider between old and new messages. Yellow reset banner at top: "Environment reset. Workspace configs applied, but session-local changes (tool installs, config edits) may need to be reinstalled." Input bar remains active.
- **Context-linked:** Opened from "Ask about this". Context link visible in chat toolbar. Agent responds with workspace context.
- **Instance hibernated:** Chat shows "This agent is hibernated. Wake it to continue." with Wake button.

---

## S-03c: Workspace Tab

**Purpose:** File browser and editor for the agent's persistent workspace. The workspace is shared across all sessions and contains the agent's identity, rules, memory, and working files.

### Layout

Two-panel split. Left: file tree (260px). Right: file editor/viewer (remaining width).

### File tree panel

| Element | Description |
|---------|-------------|
| Header | "Workspace Files" label + "+" button (new file) |
| File items | `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md` with file-text icons |
| Folder items | `.config/` (expanded by default), `memory/` (expandable), `repos/` (expandable), `artifacts/` (expandable) with folder icons and chevron |
| Nested files | Indented under parent folder (e.g., `memory/2026-04-01.md`) |
| Selection | Active file highlighted with background color |

### File editor panel

| Element | Description |
|---------|-------------|
| Header | File icon + filename + "Save" button (primary, disabled when clean) + "Discard" button (secondary, disabled when clean) |
| Content | Editable text area with line numbers gutter. Monospace font. Markdown syntax. |
| "Edit in Chat" link | Small de-emphasized text link below the header. Switches to Chat tab with the input bar pre-filled: "Update [filename]: " (cursor at end, user completes the instruction). Alternative path for users who prefer natural language editing. |

### Interactions

- Click file to open in the editor panel
- Click folder chevron to expand/collapse
- Edit file content directly. Auto-save after 2 seconds of inactivity, or manual save via button.
- Click "+" to create a new file in the workspace
- Click "Edit in Chat" to switch to Chat tab with pre-filled context

### States

- **Normal:** `.config/soul.md` selected by default. File tree shows all workspace files.
- **Editing:** Unsaved changes indicator (dot on filename). Save/Discard buttons enabled.
- **Saved:** Brief inline "Saved" confirmation.
- **Conflict:** If the agent modifies a file while the user is editing, a conflict banner appears: "This file was modified by the agent. Reload or keep your version?"
- **Empty workspace:** "This agent's workspace is empty. Start a conversation to help it build its identity and knowledge."

---

## S-06a: Schedules Tab

**Purpose:** View and manage scheduled agent invocations. Two distinct types: **cron** (task on a schedule) and **heartbeat** (autonomous periodic wake-up).

### Cron vs Heartbeat

| | Cron | Heartbeat |
|---|---|---|
| **Purpose** | Run a specific task on a fixed schedule | Periodic autonomous wake-up |
| **Prompt** | User-defined prompt (explicit task) | Reads `.config/heartbeat.md` — agent decides what to do |
| **Schedule** | Cron expression ("0 9 * * 1" = Monday 9am) | Interval (every N minutes/hours) |
| **Example** | "Generate weekly security summary from this week's findings" | "Check for new commits, review for security issues, log findings" |

### Schedule table

| Column | Description |
|--------|-------------|
| Name | Schedule display name |
| Type | Cron / Heartbeat |
| Schedule | Cron expression with human-readable preview, or interval |
| Task | Cron: user-defined prompt (truncated). Heartbeat: "Reads heartbeat.md" link. |
| Next run | Timestamp |
| Last run | Timestamp + status badge (success/failed/skipped) |
| Enabled | Toggle switch |

### Actions

- **Add Schedule** button -> Modal:
  - Type selector (Cron / Heartbeat)
  - Cron: expression input with human-readable preview ("Every Monday at 9:00 AM"), prompt textarea, timezone selector
  - Heartbeat: interval input (minutes/hours dropdown), link to edit `.config/heartbeat.md` in Workspace tab. Label: "What should the agent do each heartbeat? Edit heartbeat.md — write in plain English." heartbeat.md is a natural language instruction document, not structured config.
- **Edit** (click row) -> Same modal, pre-filled
- **Test Run** button (per schedule) -> Triggers immediately, shows result in activity
- **Delete** with confirmation

### States

- **No schedules:** "This agent has no schedules. Add one to make it proactive."
- **Schedule failed:** Last run shows red badge. Click for error details (navigates to Logs tab filtered to this schedule).

---

## S-08: Logs Tab

**Purpose:** Chronological log viewer for agent execution.

### Toolbar

| Element | Description |
|---------|-------------|
| Time range | Last 1h / 6h / 24h / 7d / Custom |
| Type filter | All / Heartbeat / Cron / Chat / Error |
| Severity filter | All / Info / Warning / Error |
| Search | Full-text search across log entries |

### Log entry row (collapsed)

| Element | Description |
|---------|-------------|
| Timestamp | Monospace, 13px |
| Type badge | Heartbeat (purple), Cron (blue), Chat (green), Error (red) |
| Severity icon | info (circle-i), warning (triangle-alert), error (circle-x) |
| Summary | One-line description, truncated |
| Duration | If applicable |
| Token count | If applicable |

**Log entry row (expanded):** Full log text (monospace, scrollable). Link to related session (if from chat) or schedule (if from heartbeat/cron). Simple trace waterfall: horizontal bar chart showing sequential steps with durations.

### States

- **Empty:** "No logs yet. Logs appear after the agent's first run."
- **Normal:** Entries listed newest-first.
- **Error highlight:** Error entries get a subtle red left border.

---

## User Flows

### F-1: Deploy Code Guardian

1. **Home (S-01):** Click "Create Agent"
2. **Creation flow (deferred):** Select Claude Code harness, provide repo, name "Code Guardian", configure basics
3. **Agent Detail > Overview (S-03a):** Agent created, status "hibernated"
4. **Agent Detail > Workspace (S-03c):** Write `.config/soul.md` (agent identity: "I am a security-focused code review agent..."), `.config/rules.md` (operating rules: "Flag issues but never auto-merge..."), `.config/heartbeat.md` (plain English: "Check for new commits, review for security issues...")
5. **Agent Detail > Schedules (S-06a):** Click "Add Schedule"
6. **Schedule modal:** Select Heartbeat, set 30-min interval. The heartbeat.md written in step 4 is already linked. Confirm.
7. **Schedule modal:** Add second schedule: Cron, "0 9 * * 1" (Monday 9am), prompt: "Generate weekly security summary from this week's findings."
8. **Agent Detail header:** Click "Wake". Agent begins first heartbeat cycle.

### F-2: Debug Failing Heartbeat

1. **Home (S-01):** See Code Guardian card with red error indicator
2. **Agent Detail > Overview (S-03a):** Recent Activity shows "Heartbeat failed" at 10:30
3. **Agent Detail > Schedules (S-06a):** Last run shows red "failed" badge. Click for error: "GitHub API returned 403 Forbidden"
4. **Resolution:** Update GitHub token in Platform Settings (deferred screen). Return to Schedules, click "Test Run."
5. **Schedules tab:** Test run succeeds, status turns green.

### F-3: Chat with Running Agent

1. **Agent Catalog (S-02):** Find Code Guardian, click to open
2. **Agent Detail > Chat (S-03b):** See suggested prompts
3. **Type:** "What were the most critical findings from last week?"
4. **Agent responds** from accumulated memory (daily logs): lists top 3 findings with severity, file locations, and status.
5. **Type:** "Create a summary report for the security team"
6. **Agent generates artifact:** Report card appears in chat with "Download PDF" action.
7. **Click download.**

### F-4: Investigate a Finding via Activity Link

1. **Agent Detail > Overview (S-03a):** See activity item: "Heartbeat found SQL injection in /api/users"
2. **Click "Ask about this"** (arrow icon on the activity item)
3. **Chat tab opens** with system message: "Re: SQL injection finding from heartbeat at 15:30"
4. **Agent responds** with full context from its workspace: severity, exact code location, commit hash, recommended fix.
5. **Type:** "Is this related to the XSS issue you found last week?"
6. **Agent cross-references** daily memory logs: "Yes, both stem from unsanitized user input in the same module."
7. **Type:** "Remember to always flag unsanitized input in this module going forward"
8. **Agent writes** to `memory/` in its workspace: "Flag unsanitized user input in /api/ module."

### F-5: Edit Workspace File

1. **Agent Detail > Workspace (S-03c):** File tree shows `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md`, `memory/`, `repos/`
2. **Click `.config/rules.md`:** Editor shows current operating rules
3. **Edit directly:** Add a new line: "Always flag hardcoded credentials in any language."
4. **Click Save.** Brief "Saved" confirmation. The agent now reads the updated rules on next invocation.
5. **Click `.config/heartbeat.md`:** Editor shows plain English instructions for heartbeat behavior. Edit as needed.

### F-6: Resume Session After Hibernation

1. **Agent Detail > Chat (S-03b):** See sidebar session list
2. **Click "Initial setup - Mar 28"** (gray dot, inactive) in the sidebar
3. **If instance is hibernated:** "This agent is hibernated. Wake it to continue." Click Wake.
4. **Session loads** with old history and reset banner: "Environment reset. Workspace configs applied, but session-local changes may need to be reinstalled."
5. **See resume divider:** "Resumed today" between old messages and input area
6. **Type:** "Can you reinstall the eslint plugin? I see the config is gone."
7. **Agent responds** and re-installs the tool in the fresh environment

### F-7: Browse Workspace and Ask About a File

1. **Agent Detail > Overview (S-03a):** See agent is running, curious about its knowledge
2. **Click `.config/soul.md` in sidebar** Workspace section
3. **Workspace tab opens** with soul.md content displayed
4. **Click "Edit in Chat"** link
5. **Chat tab opens** with input bar pre-filled: "Update soul.md: " (cursor ready)
6. **Complete the message:** "Update soul.md: add a rule about always checking for SQL injection"
7. **Agent updates** `.config/rules.md` in its workspace

### F-8: Use Debug Mode

1. **Agent Detail > Chat (S-03b):** Testing agent behavior
2. **Click bug icon** in chat toolbar to enable debug mode
3. **Send a message:** "What's the latest security report?"
4. **Agent responds.** Below the response, a collapsible debug footer appears.
5. **Expand debug footer:** See "Tokens: 1,247 in / 523 out | Latency: 2.3s (TTFT: 340ms) | Tools: workspace_read (0.2s), memory_search (1.1s) | Model: claude-sonnet-4-20250514"
6. **Diagnose:** Identify that memory_search is the bottleneck. Adjust memory structure.

### F-9: Handle Permission Request in Chat

1. **Agent Detail > Chat (S-03b):** Active conversation
2. **Type:** "Install eslint and fix all linting errors in /src"
3. **Agent requests permission:** Inline permission card appears: "Permission Required — Execute: npm install eslint"
4. **Click Allow.** Card collapses to "Allowed at 15:45". Agent proceeds.
5. **Agent requests another permission:** "Write to /workspace/repos/myapp/src/utils.ts"
6. **Click Allow.** Agent writes the fix.

---

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

**Standalone Approval Queue (S-15).** Central screen for processing all pending HiTL requests across all agents. Design requirement: process 20 requests in under 2 minutes. Includes pre-computed risk levels, keyboard shortcuts (j/k navigation, a/d approve/deny), bulk actions ("Approve All Low-Risk"), and expandable rows with agent reasoning, service-specific previews (diffs, messages), and policy match details.

**Per-Agent Approval Policy Configuration (S-07a).** Table of HiTL policies per agent (service, resource pattern, method, action). Key UX: template selector per service (e.g., GitHub "Repository Reader", "Contributor", "Full Access") that pre-populates rules for quick setup. Includes fatigue metrics panel (avg approval time, auto-approved %, queue depth trend, denied %) to help tune policies.

**Service-level approval cards.** Richer inline approval cards in chat with risk badges (Low/Medium/High/Critical), service icons (GitHub, Slack, etc.), "Why?" and "Details" collapsible sections, and "View in Queue" link. Post-action: "Approved by [name] at [time]" collapse state.

### Channel Mirroring

Two-way connection between a session and a Slack or Telegram channel:

- **What mirrors to channel:** User messages (attributed by name), agent responses, approval cards (as native Slack blocks/Telegram cards), artifacts (as file links).
- **What stays in web UI only:** Tool calls, system events, debug info.
- **Channel messages in web:** Messages from channel users appear inline with name + channel badge.
- **Connect Channel flow:** Button in chat toolbar -> popover with channel type selector (Slack/Telegram) -> channel dropdown -> Connect. Sidebar shows channel icon on connected sessions.

### Additional Screens

- **Creation Wizard:** Guided agent creation flow (harness selection, repo config, workspace setup).
- **Import Agent:** Import agent configuration from external source.
- **Platform Settings:** Global integrations (Slack, Telegram), credential management, platform-wide defaults.
- **Execution Environment:** Per-agent environment configuration (resources, network policies, mounted tools).
- **Build Progress:** Real-time build/deploy status for agent instances.
- **Audit Trail UI:** Platform-level audit log (currently delegated to OneCLI dashboard).
- **Template Editor UI:** Visual template management (currently kubectl/Helm only).
