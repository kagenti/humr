# ADR-NNN: Per-instance channel secret storage

**Date:** 2026-04-23
**Status:** Proposed
**Owner:** @pilartomas

## Context

Humr supports per-instance messaging channels (ADR-016). Two channel types exist today, with different secret shapes:

- **Slack** — a single platform-wide Slack app serves the whole install. `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` come from Helm values and are mounted into the API Server pod as env. Per-instance config in Postgres (`channels.config`) is only the `slackChannelId` — no secret.
- **Telegram** — each instance has its own bot (created by the end user via `@BotFather`), so the bot token is per-instance user input. Currently stored plaintext in the `channels.config` JSONB column.

ADR-016 predates the move from instance ConfigMaps to Postgres and does not address secret-at-rest for per-instance tokens. ADR-005 (credential gateway) covers secrets consumed by *agent* traffic through OneCLI — it does not apply here, since ADR-016 explicitly classifies messenger tokens as platform-level credentials consumed by the API Server, never by the agent pod.

The gap: a DB dump, DB read access, or incidental logging (row-level debug logs) reveals every tenant's Telegram bot tokens in clear. The platform has no notion of how per-instance channel secrets should be handled, and any future per-instance channel type (WhatsApp, Discord, etc. with user-supplied credentials) will inherit the same gap.

## Decision

**OPEN.** Three realistic options; this draft lays out the tradeoffs so we can pick one.

### Option A — App-level encryption in Postgres (AES-GCM via env key)

Continue storing the token in `channels.config`, but encrypt before write and decrypt on read. Key material provided via env (sourced from a k8s Secret created by Helm).

- Pros: smallest change; no new k8s permissions; single storage mechanism.
- Cons: key lives in API Server env (one compromise → all tokens); key rotation requires re-encrypting every row; still decrypted into memory on every read; no audit trail per-secret.

### Option B — k8s Secret per instance+channel, Postgres keeps a reference *(recommended)*

`channels.config` stores a reference (e.g. `secretName`) instead of the token. The actual token lives in a namespaced Secret owned by the API Server, labeled by instance ID for lifecycle + cleanup.

- Pros: matches existing patterns (platform Slack tokens, OneCLI CA, cert-manager output all use Secrets); RBAC-restrictable per-resource; aligns with ADR-006's "namespace-scoped K8s-native resources" preference; enables future integrations like sealed-secrets or external-secrets without code changes.
- Cons: API Server needs `get/list/watch/create/update/delete` on Secrets; Secret naming + cleanup is new code; local-dev still works (k3s gives real Secrets).

### Option C — External secret manager (Vault, AWS Secrets Manager)

- Pros: proper key management, audit, rotation.
- Cons: major new infrastructure dependency; breaks the "zero external dependencies for a local k3s install" posture of ADR-003. Out of scope for now; could be added later as a pluggable backend behind whichever interface (A) or (B) establishes.

### Related cleanup (whichever option wins)

- `TelegramConnected` event currently carries `botToken` as a field (`packages/api-server/src/events.ts`). With either A or B, the event should carry a reference (instance ID) and the subscriber reads the secret — so tokens don't traverse the in-memory event bus and cannot be captured by a future event logger.
- ADR-016 needs a short amendment noting the storage is Postgres (not ConfigMap) and pointing here for secret handling.

## Alternatives Considered

**Leave plaintext (status quo).** Rejected: any DB access, backup leak, or incidental row-level log exposes every tenant's Telegram tokens.

**Reuse OneCLI credential gateway.** Rejected by ADR-016: these are tokens consumed by the API Server directly, not agent-outbound traffic. OneCLI is the wrong layer.

**Put per-instance tokens in Helm/values.** Rejected: end-user-supplied at instance-creation time, not operator-supplied at install time. Would force a Helm upgrade per new bot.

## Consequences

All options:
- Token no longer round-trips to the UI (already done — previous commit).
- Event bus no longer carries tokens (follow-up change).

Option B specifically:
- API Server ServiceAccount gets Secret verbs scoped to its own namespace.
- New migration path for existing rows: read plaintext token → create Secret → replace `config` with reference.
- Instance deletion cascades to Secret deletion (label selector).
- `bootstrap(channelsByInstance)` needs to resolve references to live tokens before starting workers — small change in `packages/api-server/src/index.ts`.
