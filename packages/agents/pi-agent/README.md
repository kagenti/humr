# Pi Agent

Humr agent running [pi coding agent](https://github.com/badlogic/pi-mono) with persistent cross-session memory.

## Stack

| Component | Package | Purpose |
|---|---|---|
| Harness | `@mariozechner/pi-coding-agent` + `pi-acp` | pi runtime + ACP bridge to Humr UI |
| Memory | `@zhafron/pi-memory` | git-free file-based memory, auto-injected at session start |

Default model: `openai / gpt-5.4-mini`. Change in `workspace/.pi/agent/settings.json`.

## File layout

```
workspace/
  .pi/agent/
    settings.json        ← pi config (→ ~/.pi/agent/)
  work/
    .pi/
      APPEND_SYSTEM.md   ← appended to the system prompt (project-scoped)
extension/
  package.json           ← @humr/pi-rits (installed globally in the image)
  index.js               ← registers the RITS provider via pi.registerProvider()
```

## RITS (custom OpenAI-compatible provider)

The [`@humr/pi-rits`](extension/) extension is loaded by pi on startup (via `packages` in `settings.json`) and calls `pi.registerProvider("rits", …)` only when both `RITS_URL` and `RITS_MODEL` are set — otherwise the image is a no-op drop-in. Everything is driven by pod env vars.

RITS exposes one model per base URL, so each pi-agent pod targets a single endpoint. Authentication uses a `RITS_API_KEY` header (not `Authorization`) — the extension passes `apiKey: "RITS_API_KEY"` and `headers.RITS_API_KEY: "RITS_API_KEY"` (env-var names), so pi resolves the live secret from the pod env at **request time**. `authHeader: true` makes pi also send `Authorization: Bearer $RITS_API_KEY`, which RITS ignores.

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `RITS_URL` | yes | — | Full endpoint URL for the chosen RITS model. The extension appends `/v1` if not already present. |
| `RITS_MODEL` | yes | — | Model identifier (the string passed as `model` in chat-completions requests). |
| `RITS_API_KEY` | yes | — | Sent verbatim in the `RITS_API_KEY` header. Inject via an OneCLI secret with `envMappings: [{ envName: RITS_API_KEY }]`. |
| `RITS_CONTEXT_WINDOW` | no | `128000` | Context window in tokens. |
| `RITS_MAX_TOKENS` | no | `16384` | Max output tokens. |

To make RITS the default, edit `settings.json`:

```json
"defaultProvider": "rits",
"defaultModel": "<value of RITS_MODEL>"
```

Pi system prompt conventions:

| File | Scope | Behaviour |
|---|---|---|
| `~/.pi/agent/SYSTEM.md` | global | replaces the default system prompt |
| `.pi/SYSTEM.md` | project (cwd) | replaces the default system prompt |
| `~/.pi/agent/APPEND_SYSTEM.md` | global | appended to the system prompt |
| `.pi/APPEND_SYSTEM.md` | project (cwd) | appended to the system prompt |

> **`workspace/`** seeds `/home/agent/` on first boot.  
> **`workspace/work/`** seeds `/home/agent/work/` — the cwd where pi-acp spawns.  
> **`workspace/.pi/agent/`** seeds `~/.pi/agent/` — pi's global config directory.

## Memory scopes

Memory lives on the PVC (`/home/agent/` is the persistent mount), so everything survives restarts. The two scopes:

| Scope | Path | What goes here |
|---|---|---|
| **Personal** (global) | `~/.pi/agent/memory/` | Identity, user profile, preferences — facts about the user, not about a project |
| **Project** (future) | `work/memory/` | Per-workspace context: tech stack, architecture decisions, repo-specific facts |

`@zhafron/pi-memory` uses the personal scope by default (`memoryDir: ~/.pi/agent/memory`). Project-scope memory is not yet implemented.

### Memory files (personal scope)

| File | Auto-injected | Purpose |
|---|---|---|
| `MEMORY.md` | yes | Durable facts, decisions, preferences |
| `IDENTITY.md` | yes | Agent name, persona, behavioral rules |
| `USER.md` | yes | User profile (name, role, preferences) |
| `daily/YYYY-MM-DD.md` | no | Daily activity log (read via `memory` tool) |

### First-run bootstrap

On first session, `@zhafron/pi-memory` seeds all four files with empty templates and a `BOOTSTRAP.md` interview script. The agent asks the user questions, overwrites the templates with real content, then deletes `BOOTSTRAP.md`. Normal memory injection resumes from the next session onward.

### Memory tool

```
memory --action read    --target memory|identity|user|daily [--date YYYY-MM-DD]
memory --action write   --target memory|identity|user|daily --content "..." [--mode append|overwrite]
memory --action search  --query "..."
memory --action list
```

## Usage

```sh
mise run cluster:install        # first time
mise run cluster:build-agent    # rebuild after changes
```

Create an agent from the **pi-agent** template in the Humr UI, open a session, and the bootstrap flow runs automatically.

## Upgrading existing instances

The init seeder runs once (guarded by `/home/agent/.initialized`). After an image rebuild, existing instances won't pick up workspace changes automatically. Options:

- Create a fresh instance (gets the new seed)
- Delete `.initialized` on the pod and restart: `mise run cluster:shell -- rm /home/agent/.initialized`
