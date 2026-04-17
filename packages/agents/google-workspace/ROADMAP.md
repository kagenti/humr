# Google Workspace Agent — Roadmap

## Planned Enhancements

### ~~Claude Code Skills~~ (Done)

~~Replace the flat `workspace/work/CLAUDE.md` with structured Claude Code skills (`.claude/skills/`).~~ Shipped: `drive-upload`, `drive-manage`, `gmail-triage`, `calendar-agenda`, `sheets-data`.

### ~~OneCLI OAuth Flow for Local Development~~ (Done)

~~Google's OAuth 2.0 policy requires HTTPS for redirect URIs on subdomains (e.g., `onecli.localhost:4444`). This prevents the built-in OneCLI OAuth flow from working in local development.~~ Shipped: `onecli.externalHostname: localhost` in `values-local.yaml` routes OneCLI through plain `localhost:4444`, which Google exempts from HTTPS requirements.

### ~~Automatic OAuth Token Refresh~~ (Not needed)

~~With the native OAuth flow (above), OneCLI receives refresh tokens during the initial consent. A future enhancement could proactively refresh tokens before expiry to avoid transient 401s.~~ OneCLI apps already handle token refresh automatically — no additional work needed.
