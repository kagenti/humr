# OneDrive Transcript Processing Agent

A Humr agent that polls Microsoft Graph for new Teams meeting transcripts, converts them into structured markdown meeting notes, and posts the results to a Slack channel.

## How It Works

On a cron schedule (default: every 30 minutes), the agent:

1. Reads `state/processed.json` to skip transcripts it has already handled.
2. Lists the connected user's calendar events with Teams online meetings (`/me/events` with `isOnlineMeeting=true`).
3. For each meeting, resolves the `onlineMeeting` resource by its `joinUrl`, then lists transcripts.
4. Downloads each new transcript as VTT.
5. Parses the VTT into structured JSON (speakers, segments, duration).
6. Generates structured markdown meeting notes (subject, attendees, summary, key topics, action items, detailed notes).
7. Posts the notes to the configured Slack channel.
8. Records the processed transcript ID in `state/processed.json` (capped at 20 entries).

Authentication to Microsoft Graph goes through OneCLI's MITM proxy — the agent uses `MICROSOFT_GRAPH_TOKEN=humr:sentinel` and the proxy swaps in a real OAuth bearer token transparently.

### Scope and limits

- ✅ **Scheduled Teams meetings** (those that appear on the user's calendar) are fully supported.
- ❌ **MeetNow / ad-hoc channel meetings** are not supported. They have no calendar entry, and the bulk `getAllTranscripts` API requires application permissions + a Teams Application Access Policy (heavy admin overhead). For transcripts to be processed, the meeting must be scheduled via the calendar (not started with "Meet now").

## Setup

### 1. Register an Azure app

1. Go to [Azure Portal > App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) > **New registration**.
2. **Supported account types**: single-tenant.
3. **Redirect URI**: `http://localhost:4444/api/apps/microsoft-graph/callback` (for local dev). Production: `http://<your-onecli-host>/api/apps/microsoft-graph/callback`.
4. Under **API permissions**, add Microsoft Graph **Delegated** permissions:
   - `Calendars.Read` — list calendar events to find scheduled Teams meetings
   - `OnlineMeetings.Read` — resolve a meeting ID from its Teams join URL
   - `OnlineMeetingTranscript.Read.All` — list and download VTT transcripts (admin consent required by Microsoft policy, but the scope only grants per-user access)
   - `User.Read` — sign in
   - `offline_access` — refresh tokens
5. Click **Grant admin consent for {tenant}**.
6. Under **Certificates & secrets**, create a client secret. Copy the **Application (client) ID**, **Client Secret**, and **Tenant ID**.

### 2. Connect Microsoft Graph in OneCLI

1. Open OneCLI at http://localhost:4444 → **Apps** → **Microsoft Graph**.
2. Enter Client ID, Client Secret, Tenant ID. Click **Save**.
3. Click **Connect** to start the OAuth flow. Sign in as the user whose meeting transcripts you want to process. Approve the requested scopes.

### 3. Grant the connection to the agent

1. Open the Humr UI at http://humr.localhost:4444.
2. Add a new agent from the **onedrive-transcript** template.
3. Open **Configure** → **Connections** → check **Microsoft Graph**. Save.

### 4. Configure Slack

The agent posts via a Slack MCP server configured in the schedule's `mcpServers` field. You'll need a Slack app with `chat:write` permission and a bot token. Reference: [Slack MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/slack) (or any other Slack MCP server).

### 5. Create a schedule

In the Humr UI, create a schedule on the agent with:

- **Cron**: `*/30 * * * *` (every 30 minutes)
- **Session mode**: `continuous` — the agent maintains context across runs
- **Task prompt**: e.g.
  ```
  Check for new Teams meeting transcripts since the last run, process them
  into meeting notes, and post each set of notes to the #meetings channel
  in Slack.
  ```
- **MCP servers**: configure the Slack MCP server with the bot token

## Workspace contents

```
/home/agent/work/
├── CLAUDE.md                       # Agent operating manual
├── scripts/
│   ├── fetch-new-transcripts.py    # List events, resolve meetings, download new VTTs
│   ├── parse-vtt.py                # VTT → structured JSON
│   └── mark-processed.py           # Append entry to state/processed.json
└── state/
    └── processed.json              # Last 20 processed transcripts (managed by scripts)
```

The workspace is persisted on the `/home/agent` PVC, so `state/processed.json` survives pod restarts.

## Architecture

The agent uses the Microsoft Graph REST API directly (no MCP server), with the OneCLI gateway handling token injection and refresh. The `microsoft-graph` provider in OneCLI is configured with tenant-aware token URL refresh — see `apps/web/src/lib/apps/microsoft-graph.ts` and `apps/gateway/src/apps.rs` in the OneCLI repo.

## Future considerations

- **Box upload**: post-processing to a Box folder (separate from Slack). Out of scope for this initial version.
- **Application permissions**: required for processing MeetNow / channel meetings. Would need a Teams Application Access Policy configured by the tenant admin (PowerShell). Not implemented today; delegated auth covers scheduled meetings only.
