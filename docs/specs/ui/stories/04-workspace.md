# Workspace

**As a** user, **I want to** browse and edit the agent's workspace files directly **so that** I can configure the agent's identity, rules, and heartbeat behavior without going through chat.

## Screen(s)

- S-03c: Workspace Tab

## Layout

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
| "Edit in Chat" link | Small de-emphasized text link below the header. Switches to Chat tab with the input bar pre-filled: "Update [filename]: " (cursor at end, user completes the instruction). |

## Interactions

- Click file to open in the editor panel
- Click folder chevron to expand/collapse
- Edit file content directly. Auto-save after 2 seconds of inactivity, or manual save via button.
- Click "+" to create a new file in the workspace
- Click "Edit in Chat" to switch to Chat tab with pre-filled context

## States

- **Normal:** `.config/soul.md` selected by default. File tree shows all workspace files.
- **Editing:** Unsaved changes indicator (dot on filename). Save/Discard buttons enabled.
- **Saved:** Brief inline "Saved" confirmation.
- **Conflict:** If the agent modifies a file while the user is editing, a conflict banner appears: "This file was modified by the agent. Reload or keep your version?"
- **Empty workspace:** "This agent's workspace is empty. Start a conversation to help it build its identity and knowledge."

## Scenario: Edit Workspace File

1. File tree shows `.config/soul.md`, `.config/rules.md`, `.config/heartbeat.md`, `memory/`, `repos/`
2. Click `.config/rules.md`. Editor shows current operating rules.
3. Edit directly: add a new line: "Always flag hardcoded credentials in any language."
4. Click Save. Brief "Saved" confirmation. The agent reads updated rules on next invocation.
5. Click `.config/heartbeat.md`. Editor shows plain English instructions for heartbeat behavior. Edit as needed.

## Scenario: Browse Workspace and Ask About a File

1. Click `.config/soul.md` in sidebar Workspace section.
2. Workspace tab opens with soul.md content displayed.
3. Click "Edit in Chat" link.
4. Chat tab opens with input bar pre-filled: "Update soul.md: " (cursor ready).
5. Complete the message: "Update soul.md: add a rule about always checking for SQL injection"
6. Agent updates `.config/rules.md` in its workspace.

## Acceptance Criteria

- [ ] File tree displays workspace structure with correct icons (file-text, folder)
- [ ] Clicking a file opens it in the editor panel
- [ ] Folder chevron expands/collapses folder contents
- [ ] `.config/soul.md` is selected by default on first load
- [ ] Editor shows content with line numbers gutter in monospace font
- [ ] Save button enables when content is modified, disables when clean
- [ ] Discard button reverts unsaved changes
- [ ] Auto-save triggers after 2 seconds of inactivity
- [ ] Unsaved changes indicator (dot) appears on modified filename
- [ ] "+" button creates a new file in the workspace
- [ ] "Edit in Chat" switches to Chat tab with pre-filled "Update [filename]: "
- [ ] Conflict banner appears when agent modifies a file during user editing
- [ ] Empty workspace state displays appropriate message
