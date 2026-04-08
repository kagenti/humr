## Authentication

- Agent pods set `CLAUDE_CODE_OAUTH_TOKEN=placeholder` when spawning the Claude Code process
- The OneCLI proxy (`HTTPS_PROXY`) intercepts API calls and injects real credentials at the network level
- No OAuth flow or credential files needed inside the agent container
