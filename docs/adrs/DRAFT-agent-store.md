# DRAFT: Agent template store — external catalog of installable agent definitions

**Date:** 2026-04-28
**Status:** Proposed
**Owner:** @tomkis

## Context

Today an agent is a Docker image. Concrete agents (`example-agent`, `pi-agent`, `google-workspace`, `code-guardian`) live in `packages/agents/` of this repo, are built by `mise run image:agent`, and are surfaced to users through `agent-template` ConfigMaps shipped by the Helm chart ([`deploy/helm/humr/templates/*-template.yaml`](../../deploy/helm/humr/templates/)). Adding a new template means: write a Dockerfile, build an image, ship a Helm template, redeploy the chart.

This shape was a fine starting point but it hits four pressures at once:

1. **Demo agents don't belong in the platform repo.** As we add more demo/use-case agents (clawgenti, etc.) the platform repo accumulates agent code that has nothing to do with the platform. Slack agreement: the demo agents move out.
2. **The image is doing two unrelated jobs.** Today an agent image carries (a) the harness binary and platform glue, and (b) the agent's working files (`workspace/` copied to `/home/agent/` on first boot via [ADR-001](001-ephemeral-containers.md)). Tweaking a prompt or a skill requires an image rebuild even when nothing about the harness changed. The Slack consensus is that the image only earns its weight when you are modifying the harness or the base system; for the common case the agent is a *composition* — harness + repo + skills + `CLAUDE.md` + schedules + connectors — and most of that composition is data, not code.
3. **No discovery surface.** A user who wants to "install the GitHub-issue-triage agent" has no place to browse. The set of installable agents is whatever the cluster admin baked into the chart values. There is no equivalent of ADR-030's connectable skill sources for whole agents.
4. **No setup-time guidance.** Even when a template exists, the user has to know which connectors and env vars it needs — the template doesn't declare its requirements in a form the UI can drive a wizard from. Connector envs ([ADR-024](024-connector-declared-envs.md)) solved this for *connections*, not for the *agent's* requirements.

A separate, complementary thread is [kagenti/humr#335](https://github.com/kagenti/humr/issues/335) — letting the user *evolve* an installed agent by treating its workspace as a git repo with diff/commit/push back to GitHub. That issue is about lifecycle of an installed agent; this ADR is about the install entry point. They share a primitive (the agent's repo) and should agree on its shape.

## Decision

**Introduce an Agent Template Store: an external catalog of installable agent manifests, fetched by the api-server from a configurable URL. Each manifest is a composition (image, repo, skills, connectors, env, schedules) with per-field `required` flags that drive a UI install wizard.**

### 1. Template source as a primitive (sister to ADR-030 skill-source)

New ConfigMap type `humr.ai/type=template-source` — a connection to an external catalog of agent templates. Sister to `skill-source` ([ADR-030](030-skills-marketplace.md)) and to OneCLI connectors ([ADR-024](024-connector-declared-envs.md)).

Source types:

- **v0:** public HTTP URL serving a JSON catalog (e.g. GitHub Pages).
- **later:** private git with auth, marketplace integrations.

The Helm chart seeds **one** default template-source pointing at a Humr-curated GitHub Pages catalog. Cluster admins can add more via ConfigMap; in v0 only admins can add sources (mirrors the skill-source admin gate). User-added sources are deferred to a later phase.

We do **not** build a Humr-hosted marketplace service. Catalog hosting is static (GitHub Pages, plain HTTPS, internal git-pages). Humr owns transport and install UX, not catalog hosting — same line ADR-030 drew for skills.

### 2. Catalog format

A template-source URL resolves to `index.json`:

```json
{
  "version": "humr.ai/v1",
  "templates": [
    { "id": "github-triage", "manifest": "github-triage/manifest.json" },
    { "id": "release-notes", "manifest": "release-notes/manifest.json" }
  ]
}
```

Each `manifest` URL (relative to `index.json`) resolves to a single template manifest. Catalog and manifests are static files; no scraping of HTML, no dynamic API on the catalog side. The Pages HTML is for humans; the JSON is for the api-server.

### 3. Manifest shape

```yaml
version: humr.ai/v1
id: github-triage
displayName: GitHub Issue Triage
description: ...
image:
  ref: ghcr.io/kagenti/humr-base:0.5.0   # required
repo:                                     # optional
  url: https://github.com/kagenti/agent-github-triage
  ref: main
  required: true
skills:                                   # optional, references ADR-030 skill-source entries
  - source: anthropic-skills
    name: pr-review
    required: false
connectors:                               # optional
  - kind: app                             # OneCLI app connection
    provider: github
    required: true
  - kind: mcp
    name: linear
    required: false
  - kind: secret
    secretType: anthropic
    required: true
env:                                      # optional
  - name: GITHUB_OWNER
    description: GitHub org/user to triage
    required: true
  - name: TRIAGE_LABELS
    default: "needs-triage"
    required: false
schedules:                                # optional, drafts the wizard offers
  - displayName: Daily triage sweep
    rrule: "FREQ=DAILY;BYHOUR=9"
    payload: "Run the triage routine"
    required: false
init:                                     # optional inline; convention file `humr-init.sh` in repo wins if both present
  shell: |
    ./scripts/setup.sh
```

**Field rules:**

- `image.ref` is the only platform-mandatory field. Without an image there is nothing to run.
- Every other field carries its own `required: true|false` (default `false`). `required: true` means the install wizard cannot complete without that piece — the user must connect the connector, supply the env, accept the schedule, etc.
- `repo` is the dominant content path going forward. The recommended manifest pattern is `image: humr-base-derived` + `repo: <agent's git repo>`; the agent's `CLAUDE.md`, skills, prompts, scripts live in the repo. Image-baked workspace seeding ([ADR-001](001-ephemeral-containers.md)) stays valid for images that need pre-installed system tooling, but is no longer the default authoring path for "an agent."
- `init` resolves with **repo file beats manifest field**: if `repo` is set and the cloned repo contains `humr-init.sh` at root, agent-runtime executes it on first boot; otherwise it executes the manifest's inline `init.shell`. Both are idempotent (`/home/agent/.initialized` sentinel, same as today).

### 4. Install wizard

UI flow when the user picks a template from the store:

1. **Review** — name, description, what will be installed.
2. **Connectors step** — for each `connectors[i].required: true`, the wizard either confirms an existing connection or routes the user through OneCLI/MCP/secret-add inline. Skipping a required connector blocks the wizard.
3. **Env step** — collect `env[i]` values; mark required-but-empty as blockers.
4. **Skills step** — confirm skill installs (delegates to ADR-030 install endpoints).
5. **Schedules step** — accept/edit/skip each draft schedule.
6. **Confirm** — single transaction: api-server creates the `agent` ConfigMap, attaches secrets/env/skills, optionally creates the schedules, optionally clones the repo on instance first boot.

The wizard is the entire reason for per-field `required` flags — without them the UI cannot tell what to block on.

### 5. Relationship to existing pieces

- **`agent-template` ConfigMap** ([ADR-024 vocabulary, current Helm templates](../../deploy/helm/humr/templates/)) — remains the in-cluster *cache* of an installed template. The store entry materializes into an `agent-template` ConfigMap on install, identical to today's chart-shipped templates. The controller stays harness-agnostic ([ADR-023](023-harness-agnostic-base-image.md)) and resource-model unchanged ([ADR-006](006-configmaps-over-crds.md)).
- **Skills** ([ADR-030](030-skills-marketplace.md)) — manifest references skills *by source + name + version*. Install delegates to ADR-030's `POST /api/skills/install`. The store does not re-implement skill transport.
- **Connectors / envs** ([ADR-024](024-connector-declared-envs.md)) — manifest declares which connectors are needed; wizard surfaces them. Connector→env mapping is still owned by OneCLI per ADR-024; the manifest names *which connector*, not *which env*.
- **Workspace seeding** ([ADR-001](001-ephemeral-containers.md)) — repo clone on first boot is a *new* seeding mechanism that runs alongside the existing image→`/home/agent/` copy. Sequence: image seed → repo clone → init script.
- **Per-agent repo evolution** ([kagenti/humr#335](https://github.com/kagenti/humr/issues/335)) — store *installs* an agent from a repo; #335 *evolves* the installed agent by letting the user diff/commit/push the workspace back to that same repo. They are two ends of the same lifecycle; the manifest's `repo` field is the shared anchor. This ADR does not specify the push-back mechanism — that is #335's scope — but it commits to the field shape that #335 consumes.

### 6. Helm chart changes

- New value `templateStore.url` (default: the Humr-curated Pages URL). Empty disables the default store; air-gapped installs can point at an internal URL.
- Existing chart-shipped `agent-template` ConfigMaps (`default`, `pi-agent`, `google-workspace`, `code-guardian`) **migrate to the default store catalog**. The chart stops materializing them as `agent-template` ConfigMaps. A single fallback `default` template (bare `humr-base` + Claude Code, no repo) stays in the chart for fully offline installs.
- Demo agent images move out of `packages/agents/` to a separate `kagenti/agent-templates` repo whose Pages site *is* the default store.

### Phase 0 — proof of concept

**Schema additions:**

- `humr.ai/type=template-source` ConfigMap. v0 accepts one field: a public HTTPS URL to `index.json`.
- Manifest schema as in §3, validated by a Zod schema in `api-server-api`.

**API server:**

- `GET /api/templates` — flatten manifests across connected sources, owner-filterable.
- `POST /api/templates/install` — body `{ sourceId, templateId, connectorChoices, env, skills, schedules, repo? }`. Validates required fields, creates `agent` ConfigMap, calls ADR-030 skill install, attaches connectors/secrets, optionally creates schedules.

**Agent-runtime:**

- New init step: if `instance.repo` is set, `git clone --depth=1 <url> <ref>` into `/home/agent/work` after the image seed and before the init script. Failure surfaces as instance status `RepoCloneFailed` (similar to existing seed failures).

**UI:**

- New top-level **Store** view — flat list of templates from connected sources, each card showing required connectors + env at a glance.
- Install wizard as described in §4.

**Default store seed:**

- One curated catalog at `humr.kagenti.io/templates/index.json` (or wherever Pages lands), seeded with the four current chart templates plus the clawgenti use case.

**Out of scope for v0:** user-added template-sources, signature/trust verification, manifest cryptographic provenance, push-back from a running agent (see #335), template-versioning (latest only).

**Success:** A user picks a template from the Store view, walks the wizard supplying required connectors and env, ends with a running instance whose workspace was cloned from the manifest's repo and whose connectors/skills/schedules match the manifest.

### Later phases (sketch)

- User-added template-sources (mirrors ADR-030 phase progression).
- Manifest signing + signature verification on install.
- Per-template version pinning (`@1.2.3`) and update notifications.
- Per-template install telemetry surfaced in the catalog (install counts, last-update).
- Private template-sources (auth model TBD).

### Non-goals

- A Humr-hosted marketplace service (catalogs are static, externally hosted).
- Humr-defined harness contracts beyond the `humr-base` + `AGENT_COMMAND` shape from [ADR-023](023-harness-agnostic-base-image.md).
- Replacing the `agent` / `agent-instance` ConfigMap resource model.
- Cross-template sharing of state — each install produces an independent agent.

## Alternatives Considered

**Keep agents as Docker images, just move them to a separate repo.** The simplest version of "demo agents don't belong here." Solves problem (1) but not (2)–(4): authoring an agent still means building an image, there's still no discovery surface, and there's still no way to declare required connectors. Half a fix.

**Single global Helm-values list of templates.** Cluster admins edit `values.yaml` to add templates; the chart materializes ConfigMaps. Better than the status quo but locks template authoring to chart redeploy and to admin write access. Doesn't address discovery for end users at all.

**Build a Humr-hosted marketplace service.** A backend that hosts manifests, install counts, ratings, search. Rejected for the same reason ADR-030 rejected a Humr skills marketplace: there is no differentiated value in hosting a static catalog, and the cost is a new service to operate. GitHub Pages + a JSON file gets us 100% of v0.

**OCI-bundled agent definition (manifest baked into the agent image as a label).** Authoring an agent still requires an image build per change. Discovery requires scraping a registry. Rejected for the same reasons (2) and the awkwardness of (3) — registries are not browsable catalogs.

**Reuse `skill-source` for templates.** Tempting because the transport is identical, but conflates two different domain objects (skills vs. agents) into one ConfigMap type with overloaded semantics. The wizard's required-connector logic is template-specific. Keep them sister types, not a single type.

**Manifest-required image with repo *replacing* image-baked workspace entirely.** Drop ADR-001's image seed path; every agent must specify a repo. Rejected: breaks the `pi-agent`/`google-workspace` images that legitimately need pre-installed CLIs in the working dir. Coexistence is cheap.

## Consequences

**Easier:**

- Demo and customer-specific agents live in their own repos and ship at their own cadence; the platform repo stops accumulating them.
- Authoring an agent for the common case is "write a repo + a manifest and add it to a catalog" — no Dockerfile, no image build, no Helm change.
- Discovery becomes a first-class UI concept (Store view).
- Required setup (connectors, env, skills, schedules) is declared by the template author and enforced by the wizard — fewer "I installed it but it doesn't work" support loops.
- Pairs cleanly with [#335](https://github.com/kagenti/humr/issues/335): same `repo` field, install on one end, evolve on the other.
- ADR-006's ConfigMap symmetry holds: `template-source` is just another typed ConfigMap; install materializes existing `agent` / `agent-template` shapes.

**Harder:**

- Adds a new external dependency to the install path (the configured store URL). Air-gapped installs need an internal store; chart's fallback `default` template covers fully offline cases but the Store view will be empty without an internal source.
- Manifest schema is now a versioned contract between Humr and arbitrary catalog authors. Breaking changes need a `humr.ai/v2` and a migration window.
- Trust model is implicit in v0: anyone who can edit the configured store can install templates that pull arbitrary code (repo) and request arbitrary connectors (which the user must approve in the wizard). The wizard is the trust gate; manifest signing is deferred. Worth a `Security` follow-up before user-added sources land.
- New surface area: catalog spec, manifest schema, wizard UX, repo-clone init step, agent-runtime error path for clone failure. All bounded but real.
- Architecture pages need updates: `agent-lifecycle.md` (install path, repo clone in seeding), `platform-topology.md` (api-server gains template-store fetch), `persistence.md` (new `template-source` ConfigMap type, repo-cloned content lives on PVC same as today's seeded content).
- Coordination with the `kagenti/agent-templates` repo (or wherever the default store lives): Pages deploy, JSON schema validation in CI, taxonomy of curated entries. Bounded but a new operational surface.