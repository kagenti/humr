# ADR-024: Connector-declared pod envs + per-agent env overrides

**Date:** 2026-04-17
**Status:** Accepted
**Owner:** @tomas2d

## Context

Before this change, pod env vars came from two places:

1. **Controller platform envs** — `GH_TOKEN=humr:sentinel` was hardcoded in `packages/controller/pkg/reconciler/resources.go`, injected into every pod regardless of whether the agent used GitHub.
2. **Agent template envs** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_WORKSPACE_CLI_TOKEN` were hardcoded in Helm templates (`deploy/helm/humr/templates/pi-agent-template.yaml`, `google-workspace-template.yaml`), with the literal value `humr:sentinel`.

All values were the sentinel that OneCLI's MITM gateway (ADR-005, ADR-010) swapped on the wire by matching the outbound request's host against stored credentials. This worked but was rigid:

- Adding a new credential-backed env required a template edit + redeploy.
- Agents received sentinel envs even when the corresponding credential wasn't granted.
- No user-facing way to declare their own envs tied to their own connectors.
- No way for users to set arbitrary per-agent env vars at all.

## Decision

Move env declaration onto two user-managed surfaces:

1. **Connector-declared envs.** Each credential stored in OneCLI can optionally declare an ordered list of `{envName, placeholder}` pairs (`metadata.envMappings`). At instance reconciliation, the controller fetches the agent's granted secrets and flattens their `envMappings` into pod env. Selective-mode agents get only granted connectors' envs; `all`-mode agents get every connector's envs.

2. **Per-agent envs.** A user-edited list of `{name, value}` pairs stored in `agentSpec.env`. Applied to every instance of that agent.

K8s env resolution order (`last-occurrence-wins` semantics):

```
platform (controller) < connector-envs < template-envs < agent-envs < instance-envs
```

Instance-level env (already wired via `InstanceSpec.Env`) remains available for per-instance overrides.

### Storage: OneCLI metadata

`envMappings` persists in OneCLI's `Secret.metadata` JSONB column (same column already used for Anthropic `authMode`). Required patching the OneCLI fork (`apps/web/src/lib/validations/secret.ts`, `apps/web/src/lib/services/secret-service.ts`) to accept, persist, and return arbitrary `metadata.envMappings` through both `POST /api/secrets` and `PATCH /api/secrets/:id`.

### Sentinel format

Kept the existing literal `humr:sentinel` — same OneCLI gateway behavior, no changes to wire-level credential injection. Users may edit the placeholder per connector; `humr:sentinel` is the default.

### Protected agent envs

`PROTECTED_AGENT_ENV_NAMES = ["PORT"]` identifies envs owned by the agent template that users must not edit or remove. Enforced on two layers:

- **UI:** PORT is filtered out of the editable list in `EditAgentSecretsDialog` and rendered in a read-only "Inherited" section with a lock icon.
- **Server:** `AgentsService.update` fetches the current spec and reapplies protected envs regardless of what the client submits (`preserveProtectedEnvs` helper). Defense against a bypassed client.

### UX surface

A single "Configure" button per agent on `ListView` opens a dialog with two tabs:

- **Credentials** — existing credential grants UI (selective / all, secret list).
- **Environment** — read-only "Inherited" rows (protected envs + connector-contributed envs tagged with source secret) + editable "Custom" list for user envs.

Connector-declared envs also render on each connector row in the Connectors view and in the secret grants list, so users can see at a glance which envs each secret contributes.

### Anthropic defaults

New Anthropic connectors auto-attach `{envName: "CLAUDE_CODE_OAUTH_TOKEN", placeholder: "humr:sentinel"}` at create time (`ANTHROPIC_DEFAULT_ENV_MAPPING` in `api-server-api`). The Claude Code SDK sends `CLAUDE_CODE_OAUTH_TOKEN` in `Authorization: Bearer …`, which matches the header OneCLI's MITM gateway already swaps for both API-key and OAuth-type Anthropic credentials — `ANTHROPIC_API_KEY` (routed via `x-api-key`) is not used because it doesn't carry OAuth tokens. Existing Anthropic connectors get a lazy backfill on first `list()` call — gated by an in-memory `Set<id>` so each secret is PATCHed at most once per server process.

## Alternatives Considered

**Humr-owned ConfigMap for env-mapping metadata.** Store envMappings in a Humr-managed K8s ConfigMap keyed by OneCLI secret id, leaving OneCLI untouched. Rejected: creates drift risk (OneCLI secrets can be deleted out-of-band, orphaning entries); adds a reconcile loop to keep the ConfigMap in sync. The OneCLI fork patch is self-contained and puts metadata where it belongs.

**Per-secret unique sentinel (e.g. `humr:sentinel:<id>`).** Would let OneCLI match credentials by sentinel ID instead of host pattern. Rejected: host-pattern matching already works, and per-secret sentinels would require gateway changes. Kept the literal sentinel for compatibility.

**Put env config on the connector OR the agent, not both.** Rejected: connector envs cover the "credential-backed env" case (GH_TOKEN, ANTHROPIC_API_KEY), while agent envs cover arbitrary config (LOG_LEVEL, FEATURE_FLAG_X). They address different use cases; both are needed.

**Eager backfill of Anthropic secrets at server startup.** Rejected: server-per-user auth (ADR-015) means no privileged server-global context — backfill must happen per-user on first list. Lazy + idempotent guard is the simplest fit.

## Consequences

- **Template migration.** `pi-agent-template.yaml`, `google-workspace-template.yaml`, and the `GH_TOKEN` platform env in `resources.go` were stripped. Existing agents created before this change retain the old envs in their agent CM (frozen at creation) — new agents created from templates receive only `PORT`.
- **Two-repo PR.** OneCLI fork at `kagenti/onecli` was patched and must be built/deployed alongside Humr. Image tag: `humr-onecli:dev` (local dev via `values-local.yaml`).
- **Extra OneCLI round-trips on reconcile.** Every instance reconcile now calls `ListSecretsForAgent` (up to 3 HTTP hops: list agents, list secrets, get grants). Follow-up candidate: cache per-owner with a short TTL.
- **Change propagation.** Envs picked up on next pod restart. Editing an agent's envs updates the StatefulSet pod-template hash, which triggers K8s rolling restart; editing a connector's envs does not automatically roll instances — users must restart the pod. Follow-up: controller could watch secret metadata changes and re-reconcile affected instances.
- **Client-bypass risk on PORT.** Defense-in-depth via server-side merge. If future protected names expand (e.g. `ONECLI_ACCESS_TOKEN`), add them to `PROTECTED_AGENT_ENV_NAMES`.

## Key files

### Controller (Go)

- `packages/controller/pkg/onecli/client.go` — `Secret.Metadata`, `SecretMetadata`, `EnvMapping`, `DefaultEnvPlaceholder`, `ListSecretsForAgent`.
- `packages/controller/pkg/reconciler/instance.go` — `collectConnectorEnvs` (I/O) + pure `envMappingsToEnvVars` (dedupe + materialize).
- `packages/controller/pkg/reconciler/resources.go` — `BuildStatefulSet` takes `connectorEnvs`; `GH_TOKEN` platform env removed.
- `packages/controller/pkg/reconciler/instance_test.go` — `TestEnvMappingsToEnvVars` covers dedupe and no-mutation.
- `packages/controller/pkg/reconciler/resources_test.go` — `TestBuildStatefulSet_ConnectorEnvs` covers merge order.

### API server (TypeScript)

- `packages/api-server-api/src/modules/secrets/types.ts` — `EnvMapping`, `DEFAULT_ENV_PLACEHOLDER`, `ENV_NAME_RE`, `isValidEnvName`, `ANTHROPIC_DEFAULT_ENV_MAPPING`.
- `packages/api-server-api/src/modules/agents/types.ts` — `PROTECTED_AGENT_ENV_NAMES`, `isProtectedAgentEnvName`, `UpdateAgentInput.env`.
- `packages/api-server-api/src/modules/{secrets,agents}/router.ts` — zod schemas accept `envMappings` / `env`.
- `packages/api-server/src/modules/secrets/services/SecretsService.ts` — `toSecretView`, idempotent Anthropic backfill.
- `packages/api-server/src/modules/secrets/infrastructure/OnecliSecretsPort.ts` — plumbs `metadata.envMappings` through OneCLI HTTP.
- `packages/api-server/src/modules/agents/services/AgentsService.ts` — `preserveProtectedEnvs` helper.

### UI (React)

- `packages/ui/src/components/Modal.tsx` — shared modal chrome (Esc + backdrop close).
- `packages/ui/src/components/KeyValueEditor.tsx` — generic `{key, value}[]` repeater with POSIX env-name validation.
- `packages/ui/src/components/EnvMappingsEditor.tsx` — thin adapter for `EnvMapping[]`.
- `packages/ui/src/components/EnvVarsEditor.tsx` — thin adapter for `EnvVar[]`.
- `packages/ui/src/dialogs/EditAgentSecretsDialog.tsx` — "Configure Agent" with Credentials | Environment tabs, inherited rows, change-aware Save.
- `packages/ui/src/dialogs/EditSecretDialog.tsx` — edit connector name + env mappings.
- `packages/ui/src/views/ConnectorsView.tsx` — env-mapping fields in Add Secret form; edit button per row.
- `packages/ui/src/views/ListView.tsx` — per-agent "Configure" button.

### Helm

- `deploy/helm/humr/templates/pi-agent-template.yaml` — removed `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.
- `deploy/helm/humr/templates/google-workspace-template.yaml` — removed `GOOGLE_WORKSPACE_CLI_TOKEN`.
- `deploy/helm/humr/values-local.yaml` — overrides `onecli.image: humr-onecli:dev` for local dev.

### OneCLI fork (sibling repo)

- `apps/web/src/lib/validations/secret.ts` — accepts `metadata.envMappings` on create/update.
- `apps/web/src/lib/services/secret-service.ts` — persists + returns metadata; `toMetadataColumn`, `toInjectionConfigColumn` helpers.

## Verification

- `mise run check` — tsc + go build/vet + helm lint/render.
- `mise run controller:test` — includes new env-materialization tests.
- OneCLI metadata round-trip probe: POST a secret with `metadata.envMappings`, GET, PATCH, GET — all preserve the field.
- E2E smoke:
  1. Connectors view → Add Secret with env mapping → Configure on agent → credential grants + verify env appears in "Inherited" tab.
  2. Configure → Environment tab → add `FOO=bar` → Save → `kubectl exec` pod → `FOO=bar` present.
  3. Attempt to edit PORT: it's not in the editable list; direct API submission is overridden by the server merge.
