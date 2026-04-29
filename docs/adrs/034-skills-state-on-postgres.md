# ADR-034: Skills application state on Postgres

**Date:** 2026-04-29
**Status:** Accepted
**Owner:** @tomkis

## Context

[ADR-030](030-skills-marketplace.md) shipped the marketplace primitives on the substrates available at the time: a `humr.ai/type=skill-source` ConfigMap per user-connected source, an `InstanceSpec.skills` array on the instance ConfigMap for installed-skill refs, and an `InstanceSpec.publishes` array for publish records. Cluster-admin-declared "system" sources were rendered into the same ConfigMap shape by a Helm template.

Since then the substrate rule was tightened by [`docs/architecture/persistence.md`](../architecture/persistence.md) (post-[ADR-017](017-db-backed-sessions.md) refinement): a domain resource belongs on a ConfigMap **iff the controller reconciles it**. The Skills bounded context fails this test in three places:

- The Go controller never reads `humr.ai/type=skill-source` ConfigMaps.
- The Go controller never acts on `InstanceSpec.skills` or `InstanceSpec.publishes`; it round-trips the fields verbatim so the api-server can write them back.
- Helm-rendered "system source" ConfigMaps exist purely as a delivery channel for static admin config — using the K8s API as a generic key-value store.

This is the persistence-doc footnote ("ADR-006's 'K8s is the database' framing predates Postgres landing in the platform") landing on a real concrete case. ADR-030's product decision stands; only its storage-substrate choice is being revisited.

## Decision

**Move Skills application state to Postgres. Move admin-declared system sources to api-server config.**

### What moves

| Concept | Was | Becomes |
|---|---|---|
| User-created Skill Source | `humr.ai/type=skill-source` ConfigMap (user-owned) | Row in Postgres `skill_sources` (owner, gitUrl unique per owner) |
| Installed Skill Ref | `InstanceSpec.skills[]` on the instance ConfigMap | Row in Postgres `instance_skills` keyed by `(instanceId, source, name)` |
| Skill Publish Record | `InstanceSpec.publishes[]` on the instance ConfigMap | Row in Postgres `instance_skill_publishes` keyed by `instanceId` |
| System Skill Source | `humr.ai/type=skill-source` + `humr.ai/system=true` ConfigMap rendered by Helm | JSON env var `SKILL_SOURCES_SEED` on the api-server pod, parsed once at startup |

### Field rename

`InstanceSpec.publishes` (now off the spec) is exposed on `SkillsState` as **`instancePublishes`** instead of the ambiguous `publishes`. The contract type `SkillPublishRecord` itself is unchanged.

### Cleanup

Per-instance Skills rows (`instance_skills`, `instance_skill_publishes`) cascade off `InstanceDeleted` via a saga in the Skills module — same pattern the channels module already uses ([`channel-cleanup.ts`](../../packages/api-server/src/modules/agents/sagas/channel-cleanup.ts)). `skill_sources` rows are owner-scoped and untouched by instance deletion.

### System-source IDs

Slug-of-name (kebab-cased), prefixed `skill-src-seed-`. Stable across api-server restarts as long as the name doesn't change. Slug collisions across seed entries fail the api-server boot with a clear stderr — they would otherwise silently shadow each other.

### Seed parsing

`SKILL_SOURCES_SEED` is a JSON array of `{name, gitUrl}`. Validated by Zod at startup; malformed JSON or shape mismatch crashes the pod. This is intentional — the alternative is a missing-source bug discovered when a user clicks Install.

### Controller

`Skills`, `Publishes`, and the `SkillSourceSpec` parser are removed from the Go types. The Go controller no longer parses or round-trips any Skills-bounded fields; `InstanceSpec` is now a pure declaration of what the controller actually reconciles.

### Migration

None. Existing dev-cluster `skill-source` ConfigMaps and the `skills:` / `publishes:` keys on instance ConfigMaps become inert: the new TS writer omits the fields on the next `updateSpec`, and the new Go parser doesn't declare them. Anyone rebasing onto this change loses dev-cluster sources and installed-skill drift state on rebase — acceptable scope for the marketplace branch which has not shipped.

## Consequences

- The instance `spec.yaml` reads as a pure controller-reconciled document.
- A second store (Postgres) participates in every per-instance read that wants the skills view; the existing per-channel pattern already does this without observable cost.
- Multi-replica api-server is still single-replica today; the seed list parsed once at boot is fine. If api-server ever scales out, every replica re-parses the same env var — no coordination needed.
- ADR-030 is unaffected as a product decision. Its "skill source as a primitive" framing carries over identically.

## Supersedes

- ADR-030's substrate choices for Skill Source, `InstanceSpec.skills`, `InstanceSpec.publishes`, and the helm-rendered seed ConfigMap. The product decision stands.
