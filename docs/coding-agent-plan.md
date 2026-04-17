# Neutral Coding Agent Plan

## Summary

Humr should stop presenting the built-in coding template as provider-branded.
The default template should become a neutral `coding-agent`, while Claude,
Codex, and other harnesses are treated as implementation choices behind that
template.

Short-term, this means:

- rename the visible default template away from `claude-code`
- keep image selection deployment-driven
- add first-class OpenAI provider setup
- make onboarding and warnings provider-aware instead of Anthropic-only

Long-term, Humr can decide whether provider choice stays deployment-level or
becomes an explicit user-facing option in the platform model.

## Implementation Notes

This plan is intended to be implemented incrementally, with each step producing
one reviewable commit. The preferred order is:

1. fix identity and naming first
2. then fix user-facing provider setup
3. then make onboarding/provider checks provider-aware
4. only after that decide whether provider choice becomes a first-class
   platform concept

Each step should leave the repo in a working state and pass the normal
verification flow.

## Goal

Move Humr from a provider-branded default template (`claude-code`) to a
provider-agnostic product model where the built-in template is a neutral
`coding-agent`, and Claude/Codex/Gemini are implementation options rather than
the primary identity shown to users.

## Problem

The current Codex branch exposes an awkward mismatch:

- the built-in template is still named like a Claude-specific agent
- local dev swaps the backing image to Codex
- the UI still assumes provider setup means Anthropic

This makes the platform feel less harness-agnostic than the architecture
intends.

## Target Model

Separate these concerns explicitly:

- **Template identity**: what kind of agent this is in Humr
- **Provider / harness**: Claude Code, Codex, Gemini CLI, etc.
- **Image implementation**: the concrete container image that runs the harness

Desired example:

- template: `coding-agent`
- provider: `Codex`
- image: `ghcr.io/.../codex-agent`

Not:

- template identity = `claude-code`
- but actual implementation = Codex

## Phase 1

Keep the platform model simple while removing the user-facing mismatch.

### 1. Rename the built-in template

Replace the visible default template identity with a neutral name such as
`coding-agent`.

Scope:

- Helm values
- seeded template names
- visible UI labels
- docs and examples

Deliverables:

- the default built-in template is shown as `coding-agent`
- local Codex overrides no longer produce a mixed `claude-code`/Codex UI
- no user-facing default template label implies Claude-specific behavior unless
  the selected harness is actually Claude

### 2. Keep image selection deployment-driven

Do not introduce full provider selection into the API model yet.

For now:

- Humr still ships one built-in `coding-agent` template
- deployment config decides whether that template resolves to a Claude or Codex
  image

This preserves the current single-template approach while removing
provider-branded naming.

Deliverables:

- no API redesign required
- Codex local-dev path still works
- Claude remains selectable by deployment config rather than by renaming the
  template back to a provider-branded identity

### 3. Fix provider UX assumptions

Update the UI so it no longer assumes:

- provider = Anthropic
- built-in coding template = Claude

Replace these with neutral concepts:

- `provider`
- `harness`
- `coding agent`

Deliverables:

- empty states and onboarding text stop equating “provider” with Anthropic
- agent cards and template descriptions do not imply Claude unless that is the
  actual configured harness
- helper text stays understandable for users who do not know the implementation
  details

### 4. Add first-class OpenAI provider support

The Providers screen should support OpenAI directly instead of showing it as
“Coming Soon”.

Generic secrets can remain available as a lower-level fallback, but should not
be the primary onboarding path for Codex agents.

Deliverables:

- user can add an OpenAI key from the Providers screen
- UI stores it using the same underlying secret system as the rest of the app
- Codex setup no longer requires knowledge of the generic Connections fallback

### 5. Make agent creation provider-aware

The add-agent flow should infer expected provider requirements from the selected
template or image and show the correct warnings, badges, and guidance.

Examples:

- Claude-backed coding agent -> guide user toward Anthropic setup
- Codex-backed coding agent -> guide user toward OpenAI setup

Deliverables:

- add-agent warnings are based on the selected template/image, not just on the
  presence of Anthropic secrets
- the “Get started” flow remains coherent for both Claude and Codex-backed
  coding agents
- badges or labels distinguish provider-specific readiness without exposing too
  much implementation detail

## Phase 2

Once Phase 1 is stable, decide whether provider choice becomes a first-class
platform concept.

Two viable directions:

### Option A. One built-in coding template, provider selected by deployer

- simplest model
- keeps provider choice out of the user-facing product model
- good if installations usually standardize on one harness

### Option B. Neutral coding template with explicit provider choice

- user selects `coding-agent`
- then selects `Claude`, `Codex`, or another supported harness
- platform resolves that choice to the backing image and provider requirements

This is the cleaner long-term multi-provider model, but requires API and UI
modeling work.

## Recommended Order

1. Rename `claude-code` to `coding-agent` as the visible default template
2. Fix UI language and onboarding to be provider-neutral
3. Add first-class OpenAI provider setup
4. Make add-agent warnings and badges provider-aware
5. Decide whether provider selection remains deployment-driven or becomes
   explicit in the platform model
6. Update docs and examples after the model is stable

## Verification

After each implementation step:

- run `mise run check`
- manually confirm the affected UI path still makes sense
- prefer a small, self-contained commit over a large multi-step patch

## Non-Goals

This plan does not assume:

- one identical Docker image for all harnesses
- a universal cross-harness skill format
- immediate API redesign for fully generic provider abstractions

Different harnesses can still use different images and runtime tooling. The
goal is to make the **platform model and user experience** provider-agnostic,
even if the implementation images remain harness-specific.
