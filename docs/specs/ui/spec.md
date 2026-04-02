# ADK Platform UI Specification (MVP)

**Scope:** 9 screens plus 4 variants/modals (13 wireframes total) covering the Code Guardian use case end-to-end for two personas.
**Surface:** Web dashboard, desktop primary (1280px+).
**Design system:** Neutral (structure and behavior, not visual treatment).

## Personas

**Agent Developer.** Creates, configures, deploys, and debugs agents. Sees harness config, tools, schedules, execution logs. Primary goal: get an agent running safely and keep it running.

**End User / Agent Consumer.** Interacts with running agents, approves requests, views findings. Primary goal: get value from agents without understanding how they work.

Both personas share the same application shell. Section visibility is controlled by role. A user can hold both roles.

## Session Model

ADK agents have multiple concurrent activity streams: user chats, heartbeats, cron jobs, HiTL callbacks, and channel messages. The session model determines how these streams relate to each other and how the UI surfaces them.

**Model: Per-user sessions with shared agent workspace.**

```
Agent: Code Guardian
+-- Agent Context (platform-owned)
|   +-- Workspace: soul.md, rules.md, heartbeat.md (shared across all sessions)
|   +-- Memory: memory/2026-04-01.md (daily logs from automated runs)
|   +-- Bank: bank/team-exceptions.md (curated knowledge)
|
+-- User: Petr
|   +-- Session 1: "Security review - Apr 1" (active)
|   +-- Session 2: "Weekly summary - Mar 31" (expired, Slack mirror)
|   +-- Session 3: "Initial setup - Mar 28" (expired)
|
+-- User: Tomas
|   +-- Session 1: "Code quality check - Apr 2" (active)
|
+-- Automated Runs (heartbeat, cron)
    +-- Execute in agent context, write to workspace
```

**Key principles:**

- **Agent context is the source of truth.** The agent's workspace (soul.md, memory/, bank/) lives in a platform-owned context. Automated runs (heartbeats, crons) read from and write to this context.
- **Multiple sessions per user.** Each user can have many concurrent sessions with the same agent. Sessions are independent conversation contexts. The workspace is shared across all sessions for all users.
- **Sessions are resumable, VMs are ephemeral.** Each session spins up an ephemeral VM. Users can resume past sessions, but the VM restarts fresh. History is preserved and displayed, but session-local state (tool installs, config changes) may be lost. A soft warning banner communicates this. Sessions have a platform-managed lifespan (hours of idle time); after expiry, the VM is torn down but conversation history persists.
- **Workspace is directly editable.** Developers can edit workspace files (soul.md, rules.md, heartbeat.md, etc.) directly in the Workspace tab. The agent can also modify its own workspace files programmatically. End users see workspace files as read-only.
- **Activity linking.** Automated run outputs (findings, reports, errors) appear in the Overview tab's activity feed. An "Ask about this" action opens the Chat tab with pre-filled context, bridging the agent context into the user's conversation.
- **Two-way channel mirroring.** Sessions can be connected to a Slack or Telegram channel. Connected sessions are shared: messages from either surface (web or channel) appear in both, attributed by name. Approval cards and artifacts mirror to channels as native blocks/file links. Tool calls and system events are web-only (visible via a toggle).

**Session types and their context mapping:**

| Session type | Context | Writes to workspace? | Channel mirror? | Visible in UI |
|---|---|---|---|---|
| Heartbeat run | Agent context | Yes (daily logs, findings) | No | Overview > Activity Feed |
| Cron job | Agent context | Yes (reports, updates) | No | Overview > Activity Feed |
| User chat | User context (per session) | Via agent only | Optional (Slack/Telegram) | Chat tab + sidebar |
| HiTL callback | Agent context (resumes blocked run) | Yes | No | Activity Feed + Approval Queue |
| Channel message (Slack) | Agent context or dedicated channel context | Via agent | N/A (originates in channel) | Activity Feed |

## Information Architecture

Left sidebar navigation, role-adaptive. Shared header with global search, notifications bell (unread count), and user menu.

```
ADK
+-- Home                          [both]
+-- Agent Catalog                  [both, different actions]
+-- Agent Detail                   [both, tabs vary by role]
|   +-- Overview                   [both]
|   +-- Chat                       [both]
|   +-- Workspace                  [both; developer edit, end user read]
|   +-- Schedules                  [developer edit, end user read]
|   +-- Approvals                  [developer config, end user act]
|   +-- Logs / Activity            [developer: full logs, end user: activity history]
+-- Approval Queue                 [end user primary]
```

Deferred screens (full spec): Configuration, Execution Environment, Channel Integrations, Platform Settings, Creation Wizard, Import, Build Progress.

## Sidebar Behavior

The sidebar has two modes depending on the current page.

**Global mode** (Home, Agent Catalog, Approval Queue): Standard navigation with 3 items: Home (house icon), Agent Catalog (bot icon), Approval Queue (circle-check icon). Logo at top, user profile at bottom. Large spacer in the middle.

**Agent context mode** (any Agent Detail tab): The sidebar transforms to show agent-specific content. Layout from top to bottom:

- **Back nav.** Arrow-left icon + "All Agents" text link. Returns to Agent Catalog.
- **Agent identity.** Compact agent icon (28x28), agent name (14px semibold), status dot (green=running, red=error, gray=stopped). Persistent identity visible regardless of which tab is selected.
- **Sessions section.** Scrollable list of the user's sessions with this agent. Header: "Sessions" label + "+" button (creates new session). Each session item (~48px): session name (truncated), date, status dot (green=active, gray=expired), optional channel badge (Slack/Telegram icon if connected). Selected session: highlighted background + left accent border. Clicking a session loads it in the Chat tab. Right-click a session for context menu: Rename, Archive, Delete.
  - **Session naming:** New sessions are auto-named from the date ("Apr 2"). After the first agent response, the name updates to a short summary of the topic (agent-generated, e.g., "Security review"). Users can rename sessions manually via right-click > Rename.
  - **Session management:** Sessions can be archived (hidden from default list, accessible via "Show archived" toggle at bottom) or deleted (permanently removes conversation history, confirmation required).
- **Workspace section.** Collapsible file tree showing the agent's workspace files. Expanded by default, collapsible via chevron toggle. Header: "Workspace" label + chevron. Files: soul.md, rules.md, heartbeat.md. Folders: memory/, bank/ (collapsed by default). Clicking a file navigates to the Workspace tab with that file selected.
- **Quick nav icons.** Small icon-only row: Home, Catalog, Queue as 3 compact icons. Escape hatches to global navigation without leaving the agent view.
- **User profile.** User icon + name (same as global mode).

---

## S-01: Home

**Purpose:** Landing page after login. Role-adaptive content. Orients the user and surfaces what needs attention.

### Developer view

| Section | Data |
|---------|------|
| My Agents (card grid) | Agent name, harness badge (Claude Code / custom), status indicator (running/stopped/error), last activity timestamp |
| Platform Health (stats row) | Running agents count, failed schedules (last 24h), pending approvals |
| Quick Actions | Create Agent, Import Agent |
| Recent Activity (compact list) | Last 5 events across all agents (schedule runs, errors, approvals) |

### End User view

| Section | Data |
|---------|------|
| My Agents (card grid) | Agent name, description, status, last interaction |
| Pending Approvals (badge + top 3) | Count badge, 3 most urgent requests with agent name, operation summary, time waiting |
| Recent Findings (list) | Last 5 findings/reports from agents, with agent name and timestamp |

### Interactions

- Click agent card -> Agent Detail (S-03)
- Click approval badge -> Approval Queue (S-15)
- Click "Create Agent" -> Creation flow (deferred, placeholder)
- Click finding -> expands inline or navigates to agent chat

### States

- **Empty:** No agents yet. CTA: "Create your first agent" (developer) / "No agents assigned to you yet" (end user).
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
| Status indicator | Running (green dot), stopped (gray), error (red), building (blue pulse) |
| Last active | Relative timestamp |
| Tags | Developer-assigned labels |
| Owner | Creator name |

### Developer actions

- **Create Agent** button (top right) -> Creation flow
- **Import Agent** button -> Import flow
- Click card -> Agent Detail with full edit access
- Bulk actions: start/stop selected agents

### End User actions

- Click card -> Agent Detail (read-only tabs, chat enabled)
- **Add to My Agents** button on card (adds to Home roster)
- No create/import/edit capabilities

### States

- **Empty:** "No agents on this platform yet." Developer sees Create CTA. End User sees "Ask your administrator to set up agents."
- **Filtered empty:** "No agents match your filters." Clear filters link.

---

## S-03: Agent Detail (Tabbed Container)

**Purpose:** Central hub for a single agent. All agent-specific screens live here as tabs.

### Header (persistent across tabs)

| Element | Description |
|---------|-------------|
| Agent name | Editable by developer (inline edit icon) |
| Harness badge | "Claude Code", "Custom", etc. |
| Status indicator | Running/stopped/error with uptime counter |
| Quick actions | Developer: Start/Stop/Restart. End User: none. |
| Tab bar | Overview, Chat, Workspace, Schedules, Approvals, Logs |

Tab visibility by role:

| Tab | Developer | End User |
|-----|-----------|----------|
| Overview | Yes | Yes |
| Chat | Yes (testing) | Yes (primary) |
| Workspace | Yes (edit) | Yes (read-only) |
| Schedules | Yes (edit) | Yes (read-only) |
| Approvals | Yes (policy config) | Yes (approve/deny) |
| Logs | Yes (full logs) | Yes (as "Activity": findings, errors, approvals only) |

---

## S-03a: Overview Tab

**Purpose:** At-a-glance health and activity for this agent.

### Layout

Two columns. Left: description and metadata. Right: metrics and activity.

### Left column

| Field | Description |
|-------|-------------|
| Description | Multi-line, editable by developer |
| Owner | Creator name |
| Created | Date |
| Harness | Type + version |
| Tags | Editable by developer |

### Right column

| Section | Data |
|---------|------|
| Key Metrics (stat cards) | Invocations (24h / 7d / 30d), avg response time, error rate |
| Next Scheduled Runs | Next 3 upcoming (time, type: heartbeat/cron, prompt preview) |
| Recent Activity | Last 10 events from the agent context: schedule runs, approval requests, errors, findings. Each: timestamp, event type icon, one-line summary, **"Ask about this" action** (message-circle icon). "View all activity" link below the list navigates to the Logs tab (S-08) with filters pre-applied. |

### Interactions

- Developer: Edit description/tags inline. Click metric for detail (navigates to Logs tab with relevant filters).
- End User: View only. Click "Open Chat" shortcut to Chat tab.
- **Both: "Ask about this"** on any activity item opens the Chat tab with a pre-filled system message: "Re: [activity summary] from [timestamp]". The agent reads its workspace to provide context about the referenced event. This bridges the agent context (where automated runs write) into the user's conversation context.

### States

- **New agent:** Metrics show "No data yet." Activity empty.
- **Healthy:** Green status, metrics populated.
- **Error:** Red status, most recent error highlighted at top of activity list with "View Details" link (navigates to Logs tab filtered to errors).

---

## S-03b: Chat Tab

**Purpose:** Conversational interface with the agent. Each user gets their own sessions (per the session model). The agent reads from its shared workspace to answer questions about findings, accumulated knowledge, and automated run results.

### Layout

Chat toolbar at top, message list (scrollable, newest at bottom), input bar at bottom with send button and file upload. Session selection happens via the sidebar (see Sidebar Behavior), not in the chat area.

### Chat toolbar

Thin bar at the top of the chat area with contextual info and actions:

| Element | Description |
|---------|-------------|
| Context link (left) | When opened via "Ask about this": link icon + "Re: [activity summary] from [timestamp]". Otherwise empty. |
| Connect Channel button (right) | Secondary button: radio icon + "Connect Channel". Opens channel selector popover. When connected, shows channel badge instead. |
| System messages toggle (right) | Eye icon. Toggles visibility of tool calls and system events in the chat. Off by default (clean view). |
| Debug toggle (right) | Bug icon. Developer-only. Toggles debug info on agent messages. |

### Channel mirroring

Two-way connection between a session and a Slack or Telegram channel. When connected:

- **What mirrors to channel:** User messages (attributed by name), agent responses, approval cards (as native Slack blocks/Telegram cards with action buttons), artifacts (as downloadable file links).
- **What stays in web UI only:** Tool call details, system event messages, debug information. Hidden by default; a "Show system messages" toggle in the chat can reveal them.
- **Channel messages in web:** Messages from Slack/Telegram users appear in the web chat attributed with their name + channel badge icon.
- **Sidebar indicator:** Connected sessions show a Slack/Telegram icon in the sidebar session list.

Context ownership is a shared session model: one conversation, two surfaces. The agent participates in both simultaneously. (Privacy implications TBD: some conversations may need to be private.)

**Connect Channel flow.** Clicking "Connect Channel" opens a small popover anchored to the button:

1. **Channel type:** Two options: Slack, Telegram. Each with service icon.
2. **Channel selector:** Dropdown of available channels/chats, populated from platform-level integrations configured by the developer (deferred: Platform Settings screen). Shows channel name and member count.
3. **Connect button.** Connects the session. Popover closes. Chat toolbar shows channel badge. Sidebar session item shows channel icon.
4. **Disconnect:** When connected, the button changes to the channel badge (e.g., Slack icon + "#security-findings"). Clicking it opens the same popover with a "Disconnect" button.

### Context linking

When opened via "Ask about this" from the Overview tab, the chat toolbar shows a context link and the agent responds with context from its workspace about the referenced event. The user can then ask follow-up questions naturally.

### Message types

| Type | Rendering |
|------|-----------|
| User message | Right-aligned bubble, text + optional file attachments. Channel messages show sender name + channel badge. |
| Agent response | Left-aligned bubble, markdown rendered, code blocks with copy button |
| Agent artifact | Expandable card (report, summary, file) with download action |
| System event | Centered, muted text ("Agent requested GitHub access, awaiting approval"). Web-only, hidden by default with toggle. |
| Approval request (inline) | Full-width highlighted card (see below) |

### Inline approval card

A distinct message type for human-in-the-loop approval requests:

- **Card container:** Full chat width (not bubble-aligned), light amber background, warning border, rounded corners, 16px padding.
- **Header row:** Shield-alert icon + "Approval Required" label (semibold) + risk badge (Low/Medium/High/Critical, color-coded) + timestamp (right-aligned).
- **Operation row:** Service icon (GitHub, Slack, etc.) + human-readable description: "Push security fix to fix/xss-vuln on github.com/org/repo".
- **Collapsible sections:** "Why?" (agent reasoning) and "Details" (service-specific preview: diff, message, query). Collapsed by default.
- **Action row:** Approve button (green/primary) + Deny button (red/danger) + "View in Queue" text link.
- **Post-action state:** Card collapses to single line: "Approved by Petr at 15:45" with check icon, green background. Or "Denied" with red.

### Debug mode (developer-only)

Toggle: bug icon in chat toolbar (top right). When active:

- Each agent response message shows a collapsible debug footer below the message content.
- **Debug footer content:** Token usage (input/output), latency (total + time-to-first-token), tool calls (name, duration, status), model identifier.
- **Styling:** `$bg-secondary` background, monospace font (12px), muted text. Separated from message content by a thin border.
- Debug info is per-message, independently expandable.

### End User features

- Standard chat. No debug toggle or overlay.
- Inline approval requests appear naturally in conversation flow.

### Interactions

- Select session from sidebar (loads conversation in chat area)
- Create new session ("+" button in sidebar Sessions header)
- Send message (Enter or click Send)
- Upload file (paperclip icon)
- Download artifact
- Approve/Deny inline request (end user)
- Toggle debug mode (developer)
- Connect/disconnect channel (both)
- Toggle system message visibility (eye icon in chat toolbar, between Connect Channel and Debug)

### States

- **No conversation:** "Start a conversation with [Agent Name]." Suggested prompts based on agent description. Sidebar session list shows no sessions.
- **Active:** Messages flowing. Current session highlighted in sidebar.
- **Agent processing:** Typing indicator with elapsed time.
- **Agent error:** Error message in chat with retry option.
- **Resumed session (expired VM):** Session history displayed with a "Resumed today" divider between old and new messages. Yellow reset banner at top: "Environment reset. Workspace configs applied, but session-local changes (tool installs, config edits) may need to be reinstalled." Input bar remains active.
- **Context-linked:** Opened from "Ask about this". Context link visible in chat toolbar. Agent responds with workspace context.
- **Channel connected:** Channel badge (Slack/Telegram icon + channel name) visible in chat toolbar. Messages from channel users appear inline with attribution.

---

## S-03c: Workspace Tab

**Purpose:** File browser and editor for the agent's persistent workspace. The workspace is shared across all sessions and contains the agent's identity, rules, memory, and curated knowledge. All workspace files are plain markdown.

### Layout

Two-panel split. Left: file tree (260px). Right: file editor/viewer (remaining width).

### File tree panel

| Element | Description |
|---------|-------------|
| Header | "Workspace Files" label + "+" button (new file, developer only) |
| File items | soul.md, rules.md, heartbeat.md with file-text icons |
| Folder items | memory/ (expandable), bank/ (expandable) with folder icons and chevron |
| Nested files | Indented under parent folder (e.g., memory/2026-04-01.md) |
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
- Edit file content directly (developer). Auto-save after 2 seconds of inactivity, or manual save via button.
- Click "+" to create a new file in the workspace (developer)
- Click "Edit in Chat" to switch to Chat tab with pre-filled context

### Role behavior

- **Developer:** Full read/write access. Can edit files, create new files, save changes.
- **End User:** Read-only view. Editor panel shows content but is not editable. Save/Discard buttons hidden.

### States

- **Normal:** soul.md selected by default. File tree shows all workspace files.
- **Editing:** Unsaved changes indicator (dot on filename). Save/Discard buttons enabled.
- **Saved:** Brief inline "Saved" confirmation.
- **Conflict:** If the agent modifies a file while the developer is editing, a conflict banner appears: "This file was modified by the agent. Reload or keep your version?"
- **Empty workspace:** "This agent's workspace is empty. Start a conversation to help it build its identity and knowledge."

---

## S-06a: Schedules Tab

**Purpose:** View and manage periodic agent invocations (heartbeat and cron).

### Developer view (edit)

Table of schedules for this agent:

| Column | Description |
|--------|-------------|
| Name | Schedule display name |
| Type | Heartbeat / Cron |
| Schedule | Interval (heartbeat) or cron expression (cron) |
| Prompt / heartbeat.md | What the agent does on invocation. Cron: user-defined prompt. Heartbeat: references heartbeat.md. |
| Next run | Timestamp |
| Last run | Timestamp + status badge (success/failed/skipped) |
| Enabled | Toggle switch |

### Actions (developer)

- **Add Schedule** button -> Modal:
  - Type selector (Heartbeat / Cron)
  - Heartbeat: interval input (minutes/hours dropdown), heartbeat.md editor (full-width markdown textarea). Label: "What should the agent do each heartbeat? Write in plain English." heartbeat.md is a natural language instruction document, not structured config. Example: "Check for new commits in monitored repos. Review each for security vulnerabilities and code quality issues. Log findings to today's memory file."
  - Cron: expression input with human-readable preview ("Every Monday at 9:00 AM"), prompt textarea
  - Timezone selector
- **Edit** (click row) -> Same modal, pre-filled
- **Test Run** button (per schedule) -> Triggers immediately, shows result in activity
- **Delete** with confirmation

### End User view (read-only)

Same table but:
- No Add/Edit/Delete/Test Run actions
- Toggle switches disabled
- "Upcoming runs" label instead of management controls

### States

- **No schedules:** Developer: "This agent has no schedules. Add one to make it proactive." End User: "This agent runs on demand only."
- **Schedule failed:** Last run shows red badge. Click for error details (navigates to Logs tab filtered to this schedule).

---

## S-07a: Approvals Tab (Per-Agent)

**Purpose:** Developer configures approval policies. End User sees approval history.

### Developer view: Policy Configuration

Table of HiTL policies for this agent:

| Column | Description |
|--------|-------------|
| Service | GitHub, Slack, Database, etc. |
| Resource pattern | Glob pattern (e.g., `repos/*/pulls/*`) |
| Method | GET, POST, DELETE, * |
| Action | Allow / Deny / Require Approval |
| Approver | User or group |

### Developer actions

- **Add Policy** button -> Modal:
  - Service selector (with icons)
  - **Template selector** (key UX element): Pre-built templates per service. Example for GitHub: "Repository Reader" (all GET=allow), "Contributor" (GET=allow, PR create=allow, push to main=require-approval, delete=deny), "Full Access" (all=require-approval). Templates pre-populate the rule table; developer adjusts from there.
  - Resource pattern input with examples
  - Method selector (multi-select)
  - Action selector
  - Approver selector
- **Edit** (click row) -> Same modal
- **Delete** with confirmation

### Developer: Fatigue Metrics panel (bottom of page)

| Metric | Description |
|--------|-------------|
| Avg approval time | How long approvals sit before action |
| Auto-approved % | Requests matching "Allow" rules |
| Queue depth trend | Sparkline of pending approvals over time |
| Denied % | How often requests are rejected |

Purpose: helps developer tune policies. If auto-approved % is very high, policies may be too loose. If queue depth is growing, policies may be too strict.

### End User view: Approval History

Table of past approval requests for this agent:

| Column | Description |
|--------|-------------|
| Timestamp | When the request was made |
| Service | GitHub, Slack, etc. |
| Operation | Human-readable description ("Push to main branch") |
| Outcome | Approved / Denied / Timed out |
| Decided by | Who approved/denied |
| Latency | Time from request to decision |

Filter by outcome, service, date range.

### States

- **No policies (developer):** "This agent has no approval policies. All external access is blocked by default." This is the secure default. CTA: "Add a Policy."
- **No history (end user):** "No approval requests from this agent yet."

### Template selector detail

The template selector is a key UX element in the Add Policy flow. It reduces the complexity of policy configuration by providing pre-built templates per service.

**Step 1: Choose service.** Grid of service cards: GitHub, Slack, Database, Jira, etc. Each card: service icon (32px), service name, short description. Clicking selects and advances.

**Step 2: Choose template.** Horizontal card layout showing 3-4 pre-built templates + "Start from Scratch" (dashed border). Each template card shows: template name (bold), risk level badge (Low/Medium/High), one-line description, rule count preview. Examples for GitHub:

- **Repository Reader:** "Read-only access. All GET=allow, all writes=deny." Low risk. 3 rules.
- **Contributor:** "Can create PRs and push to feature branches. Main branch and deletions require approval." Medium risk. 7 rules.
- **Full Access:** "Everything requires approval. Maximum oversight." High risk. 1 rule.

**Step 3: Customize rules.** Editable table pre-filled from the selected template. Columns: Resource Pattern, Method, Action (Allow/Deny/Require Approval), Approver. Each row editable inline. Add Row / Delete Row buttons. "Reset to Template" link to restore defaults.

**Step 4: Review and Save.** Summary: service name, template name (or "Custom"), rule count, auto-calculated risk assessment (more "allow" = higher risk). Save button.

---

## S-08: Logs Tab

**Purpose:** Chronological log viewer for agent execution. Role-adaptive: developers see full logs, end users see a filtered activity history.

### Developer view: Logs

Full execution log with all event types.

**Toolbar:**

| Element | Description |
|---------|-------------|
| Time range | Last 1h / 6h / 24h / 7d / Custom |
| Type filter | All / Heartbeat / Cron / Chat / Error |
| Severity filter | All / Info / Warning / Error |
| Search | Full-text search across log entries |

**Log entry row (collapsed):**

| Element | Description |
|---------|-------------|
| Timestamp | Monospace, 13px |
| Type badge | Heartbeat (purple), Cron (blue), Chat (green), Error (red) |
| Severity icon | info (circle-i), warning (triangle-alert), error (circle-x) |
| Summary | One-line description, truncated |
| Duration | If applicable |
| Token count | If applicable |

**Log entry row (expanded):** Full log text (monospace, scrollable). Link to related session (if from chat) or schedule (if from heartbeat/cron). Simple trace waterfall: horizontal bar chart showing sequential steps with durations.

### End User view: Activity

Filtered to findings, errors, and approvals only. No tool call details, no debug info. Same layout but fewer event types. Tab label shows "Activity" instead of "Logs".

### States

- **Empty:** "No logs yet. Logs appear after the agent's first run."
- **Normal:** Entries listed newest-first.
- **Error highlight:** Error entries get a subtle red left border.

---

## S-15: Approval Queue (Standalone)

**Purpose:** Central action screen for end users to process all pending HiTL requests across all agents. This is the highest-stakes screen in the dashboard.

### Design requirement

Must enable processing 20 requests in under 2 minutes. Pre-computed risk levels, keyboard shortcuts, and bulk actions are critical. Approval fatigue is the #1 UX risk.

### Layout

Full-width table with expandable rows. Toolbar at top with filters and bulk actions.

### Toolbar

| Element | Description |
|---------|-------------|
| Filter: Agent | Dropdown, multi-select |
| Filter: Service | Dropdown, multi-select |
| Filter: Risk | Low / Medium / High / Critical |
| Filter: Age | Newer than / Older than |
| Bulk: Approve Selected | Button (primary) |
| Bulk: Deny Selected | Button (danger) |
| Bulk: Approve All Low-Risk | Quick action button |

### Request row (collapsed)

| Column | Description |
|--------|-------------|
| Checkbox | For bulk selection |
| Agent | Name with icon |
| Service | GitHub, Slack, etc. with icon |
| Operation | Human-readable: "Push security fix to fix/xss-vuln" |
| Risk level | Badge: Low (gray), Medium (yellow), High (orange), Critical (red) |
| Time waiting | Relative ("12 min ago"), turns red after threshold |
| Quick actions | Approve (checkmark), Deny (X) buttons |

### Request row (expanded)

Clicking a row expands to show:

| Section | Content |
|---------|---------|
| Agent reasoning | Why the agent wants to do this (from agent's request metadata) |
| Details | Service-specific: diff preview for code changes, message preview for Slack, query for database |
| Policy match | Which policy rule triggered this approval requirement |
| History | Previous similar requests and their outcomes for this agent |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| j/k | Move selection up/down |
| Space | Toggle row expansion |
| a | Approve selected |
| d | Deny selected |
| Enter | Expand/collapse selected row |

### States

- **Empty:** "No pending approvals. Your agents are operating within their policies." Positive framing, not "nothing to do."
- **Populated:** Table with requests sorted by risk (highest first), then age (oldest first).
- **Urgent:** Requests waiting beyond threshold get highlighted row background and "Waiting" badge turns red.
- **Bulk processing:** After bulk approve, brief success toast: "5 requests approved."

---

## User Flows

### D-1: Deploy Code Guardian (Developer)

1. **Home (S-01):** Click "Create Agent"
2. **Creation flow (deferred):** Select Claude Code harness, provide repo, name "Code Guardian", configure basics
3. **Agent Detail > Overview (S-03a):** Agent created, status "stopped"
4. **Agent Detail > Workspace (S-03c):** Write soul.md (agent identity: "I am a security-focused code review agent..."), rules.md (operating rules: "Flag issues but never auto-merge..."), heartbeat.md (plain English: "Check for new commits, review for security issues...")
5. **Agent Detail > Schedules (S-06a):** Click "Add Schedule"
6. **Schedule modal:** Select Heartbeat, set 30-min interval. The heartbeat.md written in step 4 is already linked. Confirm.
7. **Schedule modal:** Add second schedule: Cron, "0 9 * * 1" (Monday 9am), prompt: "Generate weekly security summary from this week's findings."
8. **Agent Detail > Approvals (S-07a):** Click "Add Policy"
9. **Policy modal:** Select GitHub, choose "Contributor" template. Adjust: push to main=deny, push to fix/*=require-approval. Save.
10. **Agent Detail header:** Click "Start". Agent begins first heartbeat cycle.

### D-2: Debug Failing Heartbeat (Developer)

1. **Home (S-01):** See Code Guardian card with red error indicator
2. **Agent Detail > Overview (S-03a):** Recent Activity shows "Heartbeat failed" at 10:30
3. **Agent Detail > Schedules (S-06a):** Last run shows red "failed" badge. Click for error: "GitHub API returned 403 Forbidden"
4. **Resolution:** Update GitHub token in Platform Settings (deferred screen). Return to Schedules, click "Test Run."
5. **Schedules tab:** Test run succeeds, status turns green.

### U-1: Process Approval Queue (End User)

1. **Home (S-01):** See "5 pending approvals" badge
2. **Click badge -> Approval Queue (S-15)**
3. **First request:** "Code Guardian wants to push security fix to fix/xss-vuln". Medium risk. 12 min waiting.
4. **Expand row:** See diff preview, agent reasoning ("Found XSS vulnerability in /api/users, created fix"). Previous similar requests: 3 approved, 0 denied.
5. **Press 'a'** to approve.
6. **Select remaining 4 low-risk requests** (checkboxes or "Approve All Low-Risk" button).
7. **Click "Approve Selected."** Toast: "4 requests approved."
8. **Queue empty.** Total time: ~45 seconds.

### U-2: Chat with Running Agent (End User)

1. **Agent Catalog (S-02):** Find Code Guardian, click to open
2. **Agent Detail > Chat (S-03b):** See suggested prompts
3. **Type:** "What were the most critical findings from last week?"
4. **Agent responds** from accumulated memory (daily logs + bank files): lists top 3 findings with severity, file locations, and status.
5. **Type:** "Create a summary report for the security team"
6. **Agent generates artifact:** Report card appears in chat with "Download PDF" action.
7. **Click download.**

### U-3: Investigate a Finding via Activity Link (End User)

1. **Agent Detail > Overview (S-03a):** See activity item: "Heartbeat found SQL injection in /api/users"
2. **Click "Ask about this"** (arrow icon on the activity item)
3. **Chat tab opens** with system message: "Re: SQL injection finding from heartbeat at 15:30"
4. **Agent responds** with full context from its workspace: severity, exact code location, commit hash, recommended fix.
5. **Type:** "Is this related to the XSS issue you found last week?"
6. **Agent cross-references** daily logs and bank files: "Yes, both stem from unsanitized user input in the same module."
7. **Type:** "Remember to always flag unsanitized input in this module going forward"
8. **Agent writes** to `bank/team-rules.md` in its workspace (agent-mediated write): "Flag unsanitized user input in /api/ module."

### U-4: Edit Workspace File (Developer)

1. **Agent Detail > Workspace (S-03c):** File tree shows soul.md, rules.md, heartbeat.md, memory/, bank/
2. **Click rules.md:** Editor shows current operating rules
3. **Edit directly:** Add a new line: "Always flag hardcoded credentials in any language."
4. **Click Save.** Brief "Saved" confirmation. The agent now reads the updated rules on next invocation.
5. **Click heartbeat.md:** Editor shows plain English instructions for heartbeat behavior. Edit as needed.

### U-5: Resume Expired Session (End User)

1. **Agent Detail > Chat (S-03b):** See sidebar session list
2. **Click "Initial setup - Mar 28"** (gray dot, expired) in the sidebar
3. **Session loads** with old history and reset banner: "Environment reset. Workspace configs applied, but session-local changes may need to be reinstalled."
4. **See resume divider:** "Resumed today" between old messages and input area
5. **Type:** "Can you reinstall the eslint plugin? I see the config is gone."
6. **Agent responds** and re-installs the tool in the fresh VM

### U-6: Connect Session to Slack (End User)

1. **Agent Detail > Chat (S-03b):** Active conversation about a security finding
2. **Click "Connect Channel"** in the chat toolbar
3. **Select Slack** and choose #security-findings channel
4. **Slack icon + channel name** appear in the chat toolbar and in the sidebar session list
5. **Subsequent messages** from either web or Slack appear in both surfaces
6. **A colleague sends a question** in #security-findings on Slack. The message appears inline in the web chat with their name and a Slack badge.

### U-7: Browse Workspace and Ask About a File (End User)

1. **Agent Detail > Overview (S-03a):** See agent is running, curious about its knowledge
2. **Click soul.md in sidebar** Workspace section
3. **Workspace tab opens** with soul.md content displayed (read-only for end user)
4. **Click "Edit in Chat"** link
5. **Chat tab opens** with input bar pre-filled: "Update soul.md: " (cursor ready)
6. **Complete the message:** "Update soul.md: add a rule about always checking for SQL injection"
7. **Agent updates** rules.md in its workspace

### U-8: Use Debug Mode (Developer)

1. **Agent Detail > Chat (S-03b):** Testing agent behavior
2. **Click bug icon** in chat toolbar to enable debug mode
3. **Send a message:** "What's the latest security report?"
4. **Agent responds.** Below the response, a collapsible debug footer appears.
5. **Expand debug footer:** See "Tokens: 1,247 in / 523 out | Latency: 2.3s (TTFT: 340ms) | Tools: workspace_read (0.2s), memory_search (1.1s) | Model: claude-sonnet-4-20250514"
6. **Diagnose:** Identify that memory_search is the bottleneck. Adjust memory structure.

---

## Cross-Cutting Concerns

**Notifications.** Bell icon in header. Types: pending approval (urgent, immediate), schedule failure (warning), agent error (error). Unread count badge. Clicking opens dropdown with recent notifications; "View All" links to full list (deferred).

**Global search.** Search bar in header. Searches agent names, descriptions, and tags. Results grouped by type (agents, approvals). Full-text search across workspace files is deferred.

**Empty states.** Every screen and section has a designed empty state with clear messaging and a CTA where applicable. No blank screens.

**Error handling.** Platform-level errors show a banner at the top of the page. Agent-level errors show inline on the relevant card or tab. Errors always include a human-readable message and a path to resolution.

**Responsive behavior.** Desktop primary (1280px+). Approval Queue is optimized for tablet (quick approvals on the go, simplified layout). No mobile support initially.
