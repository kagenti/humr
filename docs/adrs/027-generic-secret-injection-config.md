# ADR-027: Configurable injection on generic secrets (host/path + custom header)

**Date:** 2026-04-21
**Status:** Accepted
**Owner:** @tomas2d

## Context

The credential gateway (ADR-005, ADR-010) injects tokens into outbound traffic by matching a stored secret's `hostPattern` against the request host and replacing a predetermined header with the real credential. Until now, that replacement was effectively hardcoded:

- Every generic secret was injected as `Authorization: Bearer {value}`.
- Scope was limited to the host; a secret either applied to every path on that host or none.
- Anthropic had a bespoke provider-specific code path (`x-api-key` / OAuth bearer); everything else was bundled under the one-size-fits-all default.

That shape stops working once you onboard providers that:

1. Use a non-`Authorization` header (e.g. RITS authenticates with `RITS_API_KEY`, IBM-internal gateways use `x-portkey-api-key`, etc.).
2. Require a different value template (`Token {value}`, raw values without `Bearer`).
3. Serve multiple tenants or models behind the same host, where a single credential should only apply to a sub-path (e.g. `rits.example.com` + `/minimax-m2-5/*`).

The first concrete motivation was the pi-agent RITS integration (see `packages/agents/pi-agent/README.md`) — RITS is OpenAI-compatible but authenticates via `RITS_API_KEY`, and each model lives at its own `/v1`-scoped URL.

## Decision

Extend the generic-secret model with two optional scoping knobs and one full injection override. All three are persisted in OneCLI `Secret.metadata` and plumbed end-to-end (tRPC router → `OnecliSecretsPort` → `SecretView` → UI).

### `pathPattern` (optional)

Narrow scope from "whole host" to "prefix on host". `hostPattern: api.example.com`, `pathPattern: /v1/*` only injects on requests whose path matches. Clearing the field sends `null` to OneCLI, which drops the path filter entirely. Anthropic secrets continue to reject `pathPattern` (enforced in the router `superRefine`).

### `injectionConfig` (optional, generic-only)

```ts
{ headerName: string; valueFormat: string }
```

- `headerName` — which HTTP header OneCLI rewrites (e.g. `RITS_API_KEY`, `x-api-key`, `Authorization`).
- `valueFormat` — a template with a single `{value}` placeholder (e.g. `Bearer {value}`, `Token {value}`, or just `{value}` to emit the raw secret).

Empty fields in the UI fall back to the platform-wide `DEFAULT_INJECTION_CONFIG = { headerName: "Authorization", valueFormat: "Bearer {value}" }` — a single exported constant that the server fallback, the port, and the UI placeholder all read from so the "default" is never out of sync.

### Server-side invariants

- Anthropic secrets cannot carry `hostPattern`, `pathPattern`, or `injectionConfig`. All three are checked in one tRPC `superRefine` pass; the response lists every violation so the UI can surface them together.
- On update, an explicit `null` clears; `undefined` is a no-op. Applied uniformly to `pathPattern`, `injectionConfig`, and `envMappings`.

## Alternatives Considered

**Per-provider hardcoded configs in the gateway.** Keep shipping bespoke code paths per provider (Anthropic got its own, RITS would get its own, etc.). Rejected: this is O(providers) platform work for something users can declare themselves; the gateway already supports arbitrary header rewrites, we were just not exposing them.

**Free-form headers JSON instead of `{headerName, valueFormat}`.** Let the user paste a full headers object. Rejected: harder to validate, easier to misuse (no placeholder contract), and 95% of real cases only need a single header with a formatted value.

**Sentinel-per-secret (e.g. `humr:sentinel:<id>`).** Would let the gateway match by sentinel rather than host+path. Rejected: host+path matching is already how OneCLI works; per-secret sentinels would require gateway changes and force every outbound call through a rewritable template.

**Put path scoping on the agent side (request rewriting in `agent-runtime`).** Rejected: the gateway already MITMs the traffic; pushing scoping into agents duplicates logic and splits a single concern across two codebases.

## Consequences

- **pi-agent RITS shipped.** With custom `headerName: RITS_API_KEY` + `valueFormat: "{value}"` (no `Bearer`) and a `pathPattern` scoped to the deployed model, the same generic-secret form can now authenticate RITS without any pi-agent-specific wire changes. See `packages/agents/pi-agent/README.md` and the pi-rits extension at `packages/agents/pi-agent/workspace/.pi/agent/extensions/pi-rits/index.ts`.
- **Default constant in one place.** `DEFAULT_INJECTION_CONFIG` in `packages/api-server-api/src/modules/secrets/types.ts` is the single source of truth — UI placeholder, server fallback, and port default all import it. A rename or format change is a one-line edit.
- **OneCLI fork touch.** `OnecliSecret` gained optional `pathPattern` and `injectionConfig`; the fork's schema already accepted them (same JSONB metadata column as `envMappings`), so no OneCLI code change was needed beyond the existing patch from ADR-024.
- **UI surface.** `add-agent-dialog`, `edit-agent-secrets-dialog`, and the Connectors view now render the path field and a collapsible "Custom header" section. Empty inputs render placeholder text derived from `DEFAULT_INJECTION_CONFIG` so users see what the fallback would be.
- **Anthropic isolation.** Anthropic secrets remain provider-shaped (OAuth vs API Key) with a dedicated `authMode`; they don't get `pathPattern`/`injectionConfig`. The router rejects those fields at validation time — the extra fields are for generic secrets only.
- **pi-acp auth-gate workarounds** (for pi-agent specifically) are documented in its README, not lifted into platform: `OPENCODE_API_KEY` dummy env to unlock pi-acp's startup auth check, and `models.json` mirroring from the extension to satisfy its per-session gate. Upstream: [svkozak/pi-acp#15](https://github.com/svkozak/pi-acp/issues/15).

## Key files

### API (TypeScript)

- `packages/api-server-api/src/modules/secrets/types.ts` — `DEFAULT_INJECTION_CONFIG`, `InjectionConfig`, `pathPattern`, `injectionConfig` on `GenericSecretMetadata` / `SecretView`.
- `packages/api-server-api/src/modules/secrets/router.ts` — single `superRefine` consolidating Anthropic restrictions for all three fields; null-clear semantics on update.
- `packages/api-server/src/modules/secrets/infrastructure/onecli-secrets-port.ts` — plumbs `pathPattern` + `injectionConfig` through `OnecliSecret` ⇄ `SecretView`.
- `packages/api-server/src/modules/secrets/services/secrets-service.ts` — reuses `DEFAULT_INJECTION_CONFIG` on fallback.

### UI (React)

- `packages/ui/src/dialogs/add-agent-dialog.tsx` — path + custom-header fields for new generic secrets.
- `packages/ui/src/dialogs/edit-agent-secrets-dialog.tsx` — edit path/header/format; null-clear on empty.
- `packages/ui/src/dialogs/edit-secret-dialog.tsx` — symmetric edit surface from the Connectors view.
- `packages/ui/src/views/connections-view.tsx` — list renders host + path + header name.
- `packages/ui/src/store.ts` / `packages/ui/src/types.ts` — store + types pass the new fields through.

### pi-agent (consumer)

- `packages/agents/pi-agent/workspace/.pi/agent/extensions/pi-rits/index.ts` — registers the `rits` provider, reads `RITS_URL`/`RITS_MODEL`/optional tuning env vars, mirrors to `~/.pi/agent/models.json`.
- `packages/agents/pi-agent/Dockerfile` — `OPENCODE_API_KEY` dummy env for the pi-acp startup gate.
- `packages/agents/pi-agent/README.md` — end-to-end setup (OneCLI secret with custom header `RITS_API_KEY`, host+path scoping, env vars).

## Verification

- `mise run check` — tsc + helm lint/render pass.
- E2E: Connectors view → Add Secret → host `api.example.com`, path `/v1/*`, header `X-Custom-Auth`, format `Token {value}` → POSTed to OneCLI with all four fields → reload survives → edit clears path field → OneCLI drops the filter.
- E2E (pi-agent RITS): granted a generic secret with `headerName: RITS_API_KEY`, `valueFormat: "{value}"`, host+path scoped to the RITS model URL → prompt in the UI → OneCLI log shows `injections_applied=1 status=200` on `POST .../chat/completions`.
- Router rejection: POST an Anthropic secret with `hostPattern`/`pathPattern`/`injectionConfig` → 400 with all three fields reported in the single response.
