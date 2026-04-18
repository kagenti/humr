# Provider-Specific Coding Templates Plan

## Status

This plan supersedes the earlier provider-neutral `coding-agent` experiment.

Branching model for this work:

- base fix branch: `fix/session-loading`
- feature branch: `feat/provider-specific-coding-templates`

The feature branch must stay rebased on top of the session fix branch until the
session work is merged.

## Why This Plan Exists

The current provider-neutral approach created a product-model mismatch:

- a single built-in coding template can be created with either provider secrets
- provider readiness is inferred from image names instead of explicit metadata
- the chat/session config still exposes harness-specific model choices
- users can create an OpenAI-backed agent and still see Anthropic warnings
- the runtime defaults are still Claude-shaped in places

In practice, Humr does not currently have a true provider-neutral coding-agent
model. It has harness-specific behavior hidden behind a neutral template label.

That is worse than being explicit.

## Decision

Humr should stop modeling the built-in coding agent as one neutral template.

Instead:

- Humr should expose separate built-in coding templates per harness/provider
- shared runtime logic can remain shared internally
- provider requirements must be declared explicitly in template metadata
- UI readiness, warnings, and credential selection must be driven by template
  metadata, not by parsing image names

## Target Product Model

Near-term supported templates:

- `claude-code-agent`
- `codex-agent`

Each template must declare:

- template id
- display name
- description
- harness id
- provider id
- image reference
- allowed provider secret types
- default access guidance for the UI

Example shape:

```yaml
version: humr.ai/v1
kind: coding-agent-template
name: codex-agent
description: Coding agent powered by OpenAI Codex
harness: codex
provider: openai
image: ghcr.io/kagenti/humr/codex-agent:latest
allowedSecrets:
  - openai
```

Humr can still share base runtime code across templates. The user-facing model
does not need to pretend those templates are interchangeable when they are not.

## Non-Goals

This branch should not attempt to build a fully generic multi-provider agent
abstraction.

Not in scope for this iteration:

- one template that dynamically swaps provider at runtime
- multi-provider selection for a single coding agent
- automatic provider inference from image names
- redesign of all non-coding templates

## Observed Problems To Eliminate

### 1. Provider mismatch at creation time

Today the add-agent flow allows a user to create an agent from the coding
template and attach credentials from either provider.

That must stop.

Expected behavior:

- Claude template shows Anthropic guidance only
- Codex template shows OpenAI guidance only
- provider selection is not guessed from image strings

### 2. Wrong readiness badges in the agent list

Today the list view can show `Needs Anthropic` for an OpenAI-backed coding
agent because readiness is inferred from `agent.image`.

That must be replaced with template-driven readiness.

### 3. Wrong model/config controls in chat

The session config bar should reflect the connected harness session only.

Humr should not pre-bias the UI toward Anthropic-specific concepts. If the
Codex harness exposes OpenAI model choices, show those. If the Claude harness
exposes Claude model choices, show those.

### 4. Shared template identity hiding different contracts

Two agents that require different providers should not share the same template
identity unless the platform can actually enforce both contracts safely.

Humr cannot do that today.

## Required Architecture Changes

### A. Add explicit template metadata

Extend the template spec and API/UI view model to carry explicit coding-agent
metadata.

Minimum metadata:

- `harness`
- `provider`
- `allowedSecretTypes`

Likely code touchpoints:

- Helm-seeded template specs
- template repository/service mapping
- `TemplateView` in the UI
- add-agent flow
- list/readiness badges
- agent secret editing UI

### B. Replace image-string heuristics

Remove the current `providerForImage()` approach as the source of truth for
coding-agent provider requirements.

Image strings may remain a fallback for custom images, but built-in templates
must use explicit metadata.

### C. Restrict provider credential attachment by template

When the selected agent template is `claude-code-agent`:

- allow Anthropic provider credentials
- do not present OpenAI provider credentials as valid provider setup

When the selected agent template is `codex-agent`:

- allow OpenAI provider credentials
- do not present Anthropic provider credentials as valid provider setup

Generic secrets and MCP connections can still be attached independently.

### D. Make built-in templates deployment-configurable separately

Helm should expose separate built-in template blocks, not one shared
`defaultTemplate` pretending to cover all harnesses.

Suggested direction:

- `claudeCodeTemplate`
- `codexTemplate`

Each can be enabled/disabled independently by the deployer.

This supports:

- Claude-only installs
- Codex-only installs
- installs that expose both templates

## Implementation Phases

### Phase 1. Introduce explicit coding template metadata

Deliverables:

- template spec gains explicit provider/harness fields
- API returns those fields to the UI
- current built-in coding templates are seeded with explicit metadata

Exit criteria:

- the UI no longer needs image-name parsing for built-in coding templates

### Phase 2. Split the built-in coding templates

Deliverables:

- replace the single built-in coding template with separate Claude and Codex
  templates
- Helm values support enabling each template independently
- UI shows distinct template names and descriptions

Exit criteria:

- user can clearly choose Claude or Codex at template-selection time

### Phase 3. Enforce provider-specific readiness and secret selection

Deliverables:

- add-agent warnings are driven by template metadata
- agent list readiness chips are driven by template metadata
- edit-agent-connections dialog filters provider credentials by template

Exit criteria:

- a Codex agent never shows Anthropic as the required provider
- a Claude agent never shows OpenAI as the required provider

### Phase 4. Remove Claude-shaped defaults from shared UX

Deliverables:

- provider screen copy remains provider-specific only where appropriate
- coding-agent creation flow is no longer Claude-biased
- runtime defaults are reviewed so shared layers do not assume Claude unless
  they are in Claude-specific images

Exit criteria:

- no user-facing copy implies Claude is the default coding harness when the
  installation exposes Codex or both templates

### Phase 5. Manual verification across real scenarios

Scenarios to verify:

1. Claude template + Anthropic key only
2. Codex template + OpenAI key only
3. both templates enabled, both provider keys present
4. both templates enabled, only one provider key present
5. custom image path still works without breaking built-in template behavior

Exit criteria:

- no provider mismatch in create flow
- no wrong readiness chip in list view
- no misleading chat configuration panel labels

## Concrete Repo Areas

Expected files/modules to change on this feature branch:

- `deploy/helm/humr/values.yaml`
- `deploy/helm/humr/templates/*.yaml` for built-in template seeding
- `packages/api-server/src/modules/agents/...`
- `packages/ui/src/types.ts`
- `packages/ui/src/dialogs/add-agent-dialog.tsx`
- `packages/ui/src/dialogs/edit-agent-secrets-dialog.tsx`
- `packages/ui/src/views/list-view.tsx`
- `packages/ui/src/views/providers-view.tsx`
- any template/config mapping code needed to expose template metadata

## Migration Strategy

Humr should prefer a forward migration strategy:

- add new built-in templates
- migrate or deprecate the single old coding template
- avoid silently reinterpreting an existing agent’s provider contract if that
  would change its required credentials

If legacy `coding-agent` instances still exist, the UI should continue to show
them safely, but new creation should move to explicit templates.

## Recommendation

Implement the provider-specific template split now rather than trying to patch
the neutral-template approach with more heuristics.

The current bugs are not accidental UI regressions. They are symptoms of a
product model that is hiding real provider-specific behavior.
