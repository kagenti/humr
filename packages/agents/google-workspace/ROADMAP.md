# Google Workspace Agent — Roadmap

## Planned Enhancements

### Claude Code Skills

Replace the flat `workspace/work/CLAUDE.md` with structured Claude Code skills (`.claude/skills/`). Skills are composable, discoverable, and follow Claude Code conventions — the agent could ship with dedicated skills for Drive operations, Gmail triage, Calendar management, etc.

### Automatic OAuth Token Refresh

V1 uses short-lived access tokens (~1 hour) obtained via the OAuth Playground. When the token expires, the user must manually refresh it.

A future enhancement would store the OAuth refresh token in OneCLI and automatically exchange it for a new access token before expiry, removing the manual step entirely.

### OneCLI OAuth Flow for Local Development

Google's OAuth 2.0 policy requires HTTPS for redirect URIs on subdomains (e.g., `onecli.localhost:4444`). This prevents the built-in OneCLI OAuth flow from working in local development.

Options to explore:
- Configure OneCLI to use `http://localhost:<port>` as the redirect URI (plain `localhost` is exempt from the HTTPS requirement)
- Add HTTPS support to the local dev cluster (e.g., via mkcert)
