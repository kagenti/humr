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
   - Save the **Client ID** and **Client Secret**

### 2. Get an Access Token

Google's OAuth redirect URI policy doesn't support subdomain URLs like `onecli.localhost:4444` (see #154). Until that's resolved, use the **Google OAuth Playground** to get an access token:

1. Go to https://developers.google.com/oauthplayground
2. Click the **gear icon** (settings) in the top right
3. Check **"Use your own OAuth credentials"**
4. Enter your **Client ID** and **Client Secret** from step 1
5. In the left panel, select the scopes you need:
   - **Drive API v3** — `https://www.googleapis.com/auth/drive`
   - **Gmail API v1** — `https://www.googleapis.com/auth/gmail.modify`
6. Click **Authorize APIs** and sign in with your Google account
7. Click **Exchange authorization code for tokens**
8. Copy the **Access token**

> **Note:** Access tokens expire after ~1 hour. Repeat steps 6-8 to get a new one. Automatic refresh is tracked in #153.

### 3. Add the Credential in Humr

1. Open the Humr UI and go to the **Connectors** page
2. Add a new **generic secret**:
   - **Host**: `*.googleapis.com`
   - **Header**: `Authorization`
   - **Value**: `Bearer <paste-your-access-token>`
3. Grant the google-workspace agent access to this credential

### 4. Create an Agent

1. Create a new agent from the **google-workspace** template
2. Create an instance
3. Open the chat and try: "list my Google Drive files" or "triage my Gmail inbox"

## How It Works

The agent authenticates to Google APIs through Humr's credential injection:

1. The agent template sets `GOOGLE_WORKSPACE_CLI_TOKEN=humr:sentinel` in the pod environment
2. When `gws` makes a request to `*.googleapis.com`, it sends `Authorization: Bearer humr:sentinel`
3. The request goes through OneCLI's MITM proxy (`HTTPS_PROXY`)
4. OneCLI recognizes the sentinel and replaces it with the real Bearer token
5. Google receives a valid access token

The agent never sees your real Google credentials.

## Token Lifecycle

V1 uses short-lived access tokens (~1 hour). When the token expires, `gws` commands will return 401 errors. To refresh:

1. Repeat the OAuth Playground flow (steps 6-8 above) to get a new access token
2. Update the secret value in the Humr Connectors page

Automatic token refresh using refresh tokens is tracked in #153.
