# ADR-030: Skills — connectable sources and install

**Date:** 2026-04-17
**Status:** Accepted
**Owner:** @PetrBulanek

## Context

One user's breakthrough workflow never propagates. New users face a blank slate. [kagenti/humr-claw#5](https://github.com/kagenti/humr-claw/issues/5) asks for a shared skills surface in Humr, modeled on [Ramp's Glass](https://x.com/sebgoddijn/status/2042285915435937816).

Prior decisions:

- [ADR-011](011-skills-claude-marketplace.md) — standardize on Claude's plugin marketplace (single-harness assumption).
- DRAFT-skills-harness-native (closed) — platform does nothing; each harness brings its own registry.
- [ADR-023](023-harness-agnostic-base-image.md) — narrow harness contract; "skill registries are the harness's business."

Since then: [agentskills.io](https://agentskills.io) is an open cross-harness standard (38+ adopters); Pi ships alongside Claude Code; public skill marketplaces exist (skills.sh, ClawHub, LobeHub, Anthropic's repo, OpenAI's catalog).

This draft refines ADR-023. Humr doesn't define skill *format* or *interpretation* — agentskills.io and the harness do. It owns skill *transport* — same category as credentials (ADR-005/010), env (ADR-024), and workspace seeding (ADR-001).

**We do not build our own marketplace.** Skill sources are external — public marketplaces, vendor catalogs, internal git repos. Humr connects to them like it connects to MCP servers. The differentiating Humr value (transport, isolation, policy) does not require hosting the catalog.

## Decision

### 1. Skill source as a primitive

New ConfigMap type `humr.ai/type=skill-source` — a connection to an external skill source. Sister to OneCLI credential connectors (ADR-024) and MCP connections. Connected once; usable by any agent on the install.

Source types:

- **v0**: public git URL with SKILL.md directories.
- **later**: private git with auth, public marketplace integrations, direct upload.

### 2. Install

- `InstanceSpec.skills: [{source, name, version}]` — record of what's installed on an instance (UI state + history). Not the sync trigger.
- `AgentSpec.skillPaths: []` — where the harness reads skills from. Default `["/home/agent/.agents/skills/"]` (the cross-harness default). Claude Code reads `.claude/skills/`, so Claude-Code-based agents override.
- **Agent-runtime** exposes `POST /api/skills/install` and `POST /api/skills/uninstall` endpoints. On user action, the API server calls these; agent-runtime shells out to `git clone` + `cp` (or `rm -rf`) inside the pod. Skills land on the pod's PVC and persist across restarts naturally — no init container, no pod roll.
- UI: a **Skills** tab in ADR-024's Configure dialog with install checkboxes drawn from connected sources.

Agent templates own harness-specific quirks (`skillPaths`); controller stays harness-agnostic per [ADR-023](023-harness-agnostic-base-image.md). The controller is not involved in skill sync — it remains a ConfigMap reconciler only.

### 3. Publish

- **Git sources** — invisible-git. User authors a skill, clicks *publish*, Humr opens a PR on the connected repo. Git-host PR review is the gate. Non-technical users never see git.
- **Public marketplaces** — out-of-band. Users publish through each marketplace's own flow. Humr does not intermediate.

### 4. Discovery (sort + filter)

No separate recommender. Skills tab ranks the catalogue by **source-provided signals** (install counts, stars, last-updated), surfaced as-is. Plus filter chips (source, frontmatter tag) and text search.

A real recommender (Sensei/Glass pattern) needs role, usage telemetry, and cross-instance data — none collected today. See *Later phases*.

### Phase 0 — proof of concept

**Schema additions:**
- `humr.ai/type=skill-source` ConfigMap. v0 accepts one field: a public git URL.
- `AgentSpec.skillPaths: []`, default `["/home/agent/.agents/skills/"]`. `example-agent` and `google-workspace` override with `["/home/agent/.claude/skills/"]`; `pi-agent` keeps the default.
- `InstanceSpec.skills: []` — list of `{source, name, version}` entries; the record of installed state.

**Agent-runtime:** new `POST /api/skills/install` and `POST /api/skills/uninstall` endpoints. Shallow-clone the source at the specified commit SHA and `cp -r` the skill dir into every path in `skillPaths` (or `rm -rf` for uninstall).

**API server:** on UI install/uninstall, call agent-runtime's endpoint; on success, update `InstanceSpec.skills`.

**UI:** Skills tab in the Configure dialog — flat list from connected sources, install checkbox per skill.

**Seed:** one humr-admin-connected source pointing at a curated repo (~10 skills from Anthropic's repo + a small Humr-native set).

**Out of scope:** publishing, source auth, metrics, sort/filter, install-while-hibernated (button disabled when instance is stopped), hot-reload into a running session (harness rescans on next session start).

**Success:** user ticks a skill → starts a new session → agent invokes the skill.

### Later phases (sketch)

- Private-git and marketplace-API source types.
- Invisible-git publish from the UI.
- Sort + filter (source metrics, frontmatter match).
- Real recommender once role signals and install telemetry exist.
- Per-skill NetworkPolicy from declared permission manifests.

### Non-goals

- Humr-owned catalog, publishing review, or public-facing marketplace.
- Humr-invented ratings or reviews (surface source-provided ones as-is).
- Cross-install usage telemetry.
- Exhaustive harness support in v1.

## Alternatives Considered

**Build a marketplace.** Duplicates skills.sh, ClawHub, LobeHub, Anthropic, OpenAI. No differentiated value. Ramp built theirs for company-private skills — covered here by connecting a private git repo. Rejected.

**Rule-based recommender now.** Needs role, telemetry, user pool — none exist today. With only agent-template and connected-MCP signals, output is tautological or empty. Sort + filter covers v1 discovery. Deferred.

**MCP-only install (agent tool-call).** Breaks on (1) filesystem-load semantics — skills load at startup, not at runtime; (2) prompt injection drives silent installs. Install stays user-confirmed. Rejected.

**Reaffirm ADR-011 (Claude marketplace only).** Single-harness assumption no longer holds; ADR-023 commits to harness-agnostic agents. Rejected.

## Consequences

- Supersedes [ADR-011](011-skills-claude-marketplace.md); closes the harness-native draft.
- New: `humr.ai/type=skill-source`, `InstanceSpec.skills: []`, `AgentSpec.skillPaths: []` (default `["/home/agent/.agents/skills/"]`).
- Agent-runtime gains `POST /api/skills/install` and `/api/skills/uninstall` endpoints; the API server calls them on user action. The controller is not involved in skill sync.
- UI gains a Skills tab in the Configure dialog and a "connect source" flow analogous to connecting an MCP server.
- No new service or Deployment. Skill-source fetch and Skills tab logic live in the existing API Server.
- Supply-chain responsibility for skill *content* stays with the source. Optional per-skill NetworkPolicy (from declared permission manifests) can layer on later.
