## Authentication

- UI checks auth status on mount via tRPC (`auth.status`, spawns `claude auth status` CLI)
- Login uses PKCE OAuth: server generates authorize URL, UI opens it, user pastes code back, server exchanges for tokens
- Credentials saved to `~/.claude/.credentials.json`
- On error `-32000`: UI shows login banner
