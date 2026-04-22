# OneDrive Transcript Processing Agent

A Humr agent that polls OneDrive for Teams meeting recordings, downloads VTT transcripts, converts them into structured meeting notes, and posts results to Slack.

## Setup

### 1. Configure Microsoft Graph Access

The agent accesses OneDrive via a Microsoft Graph MCP server (e.g., `microsoft-mcp`). Configure the MCP server in the agent schedule's `mcpServers` field.

You will need a Microsoft Entra (Azure AD) app registration:

1. Go to [Azure Portal](https://portal.azure.com/) > **App registrations** > **New registration**
2. Set a redirect URI matching your OneCLI callback (e.g., `http://localhost:4444/api/apps/microsoft-graph/callback`)
3. Under **API permissions**, add Microsoft Graph delegated permissions:
   - `Files.Read` (read OneDrive files)
   - `Files.Read.All` (read all files the user can access)
4. Under **Certificates & secrets**, create a client secret
5. Note the **Application (client) ID** and **Client Secret**

### 2. Configure OneCLI

1. Open OneCLI at http://localhost:4444
2. Add a **Microsoft Graph** connector with your Client ID and Client Secret
3. Complete the Microsoft OAuth consent flow
4. Grant the onedrive-transcript agent access to this credential

### 3. Configure Slack

The agent posts meeting notes to Slack via an MCP server. Configure a Slack MCP server in the schedule's `mcpServers` field with a bot token that has `chat:write` permission for the target channel.

### 4. Create a Schedule

Create an agent schedule using the **onedrive-transcript** template with:

- **Cron**: `*/30 * * * *` (every 30 minutes)
- **Session mode**: `continuous` (maintains context across runs)
- **Task prompt**: "Check OneDrive for new Teams meeting transcripts, process any new VTT files, and post meeting notes to Slack."
- **MCP servers**: Configure `microsoft-mcp` and `slack-mcp` with appropriate credentials

## How It Works

1. The agent runs on a cron schedule (default: every 30 minutes)
2. Each run, it reads `state/processed.json` to skip already-processed files
3. Lists the OneDrive recordings folder via the Microsoft Graph MCP server
4. For each new `.vtt` file:
   - Downloads the transcript
   - Parses it using the bundled `parse-vtt.py` script (via `uv`)
   - Generates structured meeting notes with summary, attendees, action items
   - Posts the notes to Slack
5. Updates `state/processed.json` with newly processed file IDs (capped at 5 entries)

## Bundled Components

- **`scripts/parse-vtt.py`** — Python VTT parser that extracts speakers, timestamps, and merges consecutive same-speaker blocks into segments
- **`/process-transcript` skill** — Claude Code skill that orchestrates VTT parsing and meeting notes generation
