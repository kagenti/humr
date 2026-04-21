# Google Workspace Agent

A Humr agent template with the [Google Workspace CLI (`gws`)](https://github.com/googleworkspace/cli) pre-installed for managing Google Drive, Gmail, Calendar, Sheets, and more.

## Setup

### 1. Create a Google Cloud OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. **Enable APIs** — go to **APIs & Services > Library** and enable:
   - Google Drive API
   - Gmail API
   - (Optional) Google Sheets API, Google Calendar API
4. **Configure OAuth consent screen** — go to **APIs & Services > OAuth consent screen**:
   - User type: **External** (or **Internal** if on Google Workspace)
   - App name: anything (e.g., "Humr Agent")
   - Add scopes: `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/gmail.modify`
   - Add your Google email as a **test user**
5. **Create OAuth Client ID** — go to **APIs & Services > Credentials > + Create Credentials > OAuth client ID**:
   - Application type: **Web application**
   - Add **Authorized redirect URIs**:
     - `http://localhost:4444/api/apps/google-drive/callback`
     - `http://localhost:4444/api/apps/gmail/callback`
   - Save the **Client ID** and **Client Secret**

### 2. Connect Google Drive in OneCLI

1. Open OneCLI at http://localhost:4444
2. Navigate to **Apps** (or **Connectors**)
3. Add **Google Drive** with your **Client ID** and **Client Secret** from step 1
4. Complete the Google OAuth consent flow
5. Grant the google-workspace agent access to this credential

### 3. Create an Agent

1. Create a new agent from the **google-workspace** template
2. Create an instance
3. Open the chat and try: "list my Google Drive files" or "triage my Gmail inbox"

## How It Works

The agent authenticates to Google APIs through Humr's credential injection:

1. When you grant a `gmail` or `google-drive` connection in the agent's Configure dialog, Humr auto-populates `GOOGLE_WORKSPACE_CLI_TOKEN=humr:sentinel` into the agent's editable env list. You can edit or remove it like any custom env var.
2. When `gws` makes a request to `*.googleapis.com`, it sends `Authorization: Bearer humr:sentinel`
3. The request goes through OneCLI's MITM proxy (`HTTPS_PROXY`)
4. OneCLI recognizes the sentinel and replaces it with the real Bearer token
5. Google receives a valid access token

The agent never sees your real Google credentials. OneCLI's app registry declares which env var each provider needs; Humr reads it and populates the agent env on grant.

## Token Lifecycle

OneCLI stores the OAuth refresh token and automatically exchanges it for a new access token when the current one expires. No manual intervention is needed after the initial OAuth consent.
