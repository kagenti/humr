# ADR-DRAFT: Slack per-turn user impersonation — outbound identity follows the replier

**Date:** 2026-04-19
**Status:** Proposed
**Owner:** @tomkis
**Amends:** ADR-018
**Builds on:** ADR-015, ADR-005

## Context

Today, a Slack thread is routed to a single Humr instance by the `threadTs → instance_id` mapping (ADR-018). Every reply in that thread is relayed to the same instance, and the agent pod makes outbound calls (GitHub, Anthropic, etc.) through OneCLI using the **instance owner's** identity — the OneCLI api-key baked into the pod by the controller is scoped to whoever created the instance (ADR-015).

This conflates two distinct concepts:

1. **Which instance handles the turn** — naturally scoped to the thread: same workspace, same agent config, same conversation.
2. **Whose credentials back the outbound calls during the turn** — should naturally follow the **replier**: if Alice started the thread but Bob replies asking the agent to open a PR, the PR should be opened as Bob, not Alice.

Current behavior ties (2) to the thread initiator (Alice always), which is wrong for shared team threads: it silently attributes actions to the wrong user, consumes the wrong person's rate limits/quotas, and can produce cross-user access failures when Alice lacks a scope that Bob has.

ADR-015 already provides the primitive needed to fix this: OneCLI stores per-user credentials keyed by `keycloakSub`, and the API server exchanges JWTs via RFC 8693 to mint OneCLI-scoped tokens for any user. The plumbing is there; only the wiring is wrong.

## Decision

### 1. Outbound identity follows the replier, not the thread initiator

For each Slack message relayed to an instance, the outbound identity used by OneCLI for that turn is the `keycloakSub` of the **Slack user who sent the message**, resolved via the existing `slack_user_id ↔ keycloak_identity` link (ADR-018 §2).

Thread routing (`threadTs → instance_id`) is unchanged. The instance is still bound to the thread; only the credentials used during a single `session/prompt` turn change.

### 2. Per-turn OneCLI api-key, minted by the API server

Before calling `session/prompt` on the agent pod, the API server:

1. Resolves the replier's `keycloakSub` from the Slack event.
2. Performs RFC 8693 token exchange to obtain a OneCLI-scoped token for that `sub`.
3. Fetches (or caches) the replier's OneCLI api-key via `/api/user/api-key`.
4. Passes that api-key to the agent pod **for the duration of the turn only**.

The pod's OneCLI client uses the turn-scoped api-key for all outbound calls made while processing the prompt. When the turn completes, the pod reverts to the instance owner's default api-key (used for non-Slack activity — cron schedules, UI sessions, etc.).

### 3. Propagation mechanism — ACP `_meta` carrying a short-lived api-key

The turn-scoped api-key is passed via ACP `_meta` on the `session/prompt` request. The agent-runtime extracts it and configures the pod's outbound HTTP client to use it for the turn's lifetime. This keeps:

- **OneCLI unchanged** — it continues to authenticate by api-key as today; no new `act_as` header or delegation flow.
- **The agent unaware** — the agent process never sees a token; api-key handling stays in the runtime, consistent with ADR-005.
- **The relay path unchanged** — ACP traffic still goes through the API server (ADR-007); `_meta` is the natural extension point.

The api-key is minted with a short TTL (matching the turn timeout) and cached by the API server keyed by `(keycloakSub, instance)` to avoid per-turn token-exchange round-trips.

### 4. Access control unchanged

ADR-018's two-tier gate (channel membership + per-instance allowed users) still runs against the replier's identity, as today (`slack.ts:251`, `slack.ts:309`). Impersonation piggybacks on the existing identity resolution — no new auth path.

### 5. Workspace state remains shared — explicitly deferred

The pod's PVC, git config, `~/.claude` session files, working tree, and any on-disk credential caches are **shared across all repliers in a thread**. A turn invoked by Bob will read and mutate the same filesystem state as a turn invoked by Alice.

This is accepted for now:

- The first-order fix is attribution of outbound API calls — that's what the OneCLI gateway governs and what this ADR addresses.
- Per-user workspace isolation is a much larger design space (per-user PVC subpaths, per-turn git config rewrites, session-file partitioning, how the agent reasons about "who am I" across turns) and intersects with ADR-019's continuous-session model.
- Teams using shared Slack threads already expect shared workspace state ("we are working on this together"); the mismatch that users report is the outbound identity, not the working tree.

A follow-up ADR will address workspace isolation if and when the shared-state model proves insufficient.

### 6. Non-Slack surfaces unaffected

Direct UI sessions, cron-triggered sessions (ADR-019), and MCP/harness-API traffic continue to use the instance owner's identity. Per-turn impersonation is a Slack-channel-specific behavior because Slack is the only surface where multiple authenticated identities can drive the same instance.

## Alternatives Considered

**Do nothing — instance owner is close enough.** Rejected: silently attributes actions to the wrong user and breaks on the first real team use case (PRs opened as the wrong author, wrong quotas hit, missing scopes).

**Per-replier instance (fork the instance on first foreign reply).** Each Slack user gets their own instance when they join a thread. Rejected: fragments the conversation across instances, defeats the shared-workspace value of Slack threading, and explodes instance count.

**OneCLI `act_as` / delegation header.** API server sends its own api-key plus an `act_as: <sub>` header; OneCLI fork honors it for trusted callers. Rejected for now: adds a new trust boundary in OneCLI, requires delegation semantics in the fork, and the per-turn api-key approach achieves the same outcome with the existing token-exchange flow.

**Sidecar HTTP proxy per pod that rewrites identity.** A small sidecar inside each pod intercepts outbound traffic and stamps the current turn's identity onto OneCLI calls. Rejected: adds a new component, duplicates what the agent-runtime's HTTP client already does, and the `_meta`-based approach needs no new process.

**Thread-initiator identity as a fallback when the replier is unlinked.** If Bob hasn't run `/humr login`, fall back to Alice's identity. Rejected: violates the principle that actions are attributed to whoever requested them. ADR-018 already requires identity linking before any interaction; unlinked users are rejected at the relay, not silently impersonating someone else.

**Require explicit `act_as` confirmation from the replier per turn.** Bot prompts the user "act as yourself on this turn? (Y/n)". Rejected: approval fatigue, no user mental model for answering "no" here. The implicit contract — "your outbound calls use your credentials" — is what users expect.

## Consequences

- Outbound API calls in a Slack-driven turn are attributed to the actual replier; PRs, issues, model usage, audit logs all match who asked for the action.
- API server gains a small per-turn credential cache keyed by `(keycloakSub, instance)` with TTL tied to token exchange.
- OneCLI remains unchanged — no new headers, no delegation flow; the fork burden from ADR-015 does not grow.
- Agent-runtime gains a narrow extension point: reading a turn-scoped api-key from ACP `_meta` and scoping it to the prompt lifetime. This is behind ADR-005 — the agent process still never sees a token.
- Workspace state remains shared per-thread; actions taken by different users read/mutate the same filesystem. Accepted as a known limitation; revisit if it becomes a real problem.
- Non-Slack surfaces (UI, schedules, MCP) are unaffected and continue to run as the instance owner.
- Unlinked Slack repliers continue to be rejected at the relay (ADR-018 §2) — no impersonation fallback.
- Error paths: if token exchange or api-key fetch fails for a given turn, the relay posts an ephemeral error to Slack and does not fall back to the instance owner's identity — failing closed is the safe default for credential routing.
