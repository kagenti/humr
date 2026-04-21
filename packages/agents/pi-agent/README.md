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
  .pi/agent/extensions/pi-rits/
    index.ts             ← auto-discovered by pi on startup; registers the RITS provider from env vars
```

## RITS (custom OpenAI-compatible provider)

The [`pi-rits`](workspace/.pi/agent/extensions/pi-rits/index.ts) extension is auto-discovered by pi from `~/.pi/agent/extensions/`. It registers a `rits` provider tuned for vLLM (what RITS runs) and mirrors the config into `~/.pi/agent/models.json`.

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `RITS_URL` | yes | — | Endpoint URL; `/v1` is appended if missing. |
| `RITS_MODEL` | yes | — | Model identifier. |
| `RITS_REASONING` | no | `false` | Enable pi's thinking UI for reasoning-capable models. |
| `RITS_CONTEXT_WINDOW` | no | `128000` | Context window in tokens. |
| `RITS_MAX_TOKENS` | no | `16384` | Max output tokens. |
| `RITS_THINKING_FORMAT` | no | — | `qwen`, `qwen-chat-template`, `zai`, `reasoning_effort`, or `openrouter` — request-body hint for servers with a matching reasoning parser. |

The API key is **not** a pod env var. Configure it as a OneCLI generic secret with `RITS_API_KEY` as the custom injection header and a host pattern matching your RITS deployment. OneCLI injects the header on outbound traffic at the proxy layer.

To make RITS the default model, edit `settings.json`:

```json
"defaultProvider": "rits",
"defaultModel": "<value of RITS_MODEL>"
```

### pi-acp auth-gate workarounds ([#15](https://github.com/svkozak/pi-acp/issues/15))

1. *Startup gate* — `pi-acp` refuses to spawn `pi` unless a recognized credential exists. Satisfied by the dummy `ENV OPENCODE_API_KEY=pi-acp-auth-gate-bypass` in the Dockerfile (allow-listed name, unused by any pi provider).
2. *Per-session gate* — `pi-acp` re-checks `models.json.providers[*].apiKey` on every `session/prompt`. Satisfied by the extension mirroring its `registerProvider` config to `models.json` on load; the `apiKey` value there is a placeholder.

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
