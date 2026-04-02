# Architecture Decision Records

This folder contains ADRs for the Humr project.

## Conventions

- **Accepted ADRs** are numbered sequentially: `NNN-short-title.md`
- **Draft ADRs** (open questions, no decision yet) use: `DRAFT-short-title.md`
- Drafts get a number only when a decision is made and status moves to Accepted
- Numbers are never reused — gaps are fine
- File names use short kebab-case like branch names — 2-3 words max (e.g., `006-configmaps-over-crds.md`, not `006-configmaps-over-crds-namespace-scoped-resource-model.md`)

## Template

```markdown
# ADR-NNN: Title

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNN
**Owner:** @github-username — the person accountable for this decision. They drive it to resolution, revisit it if context changes, and are the first point of contact for questions.

## Context

What is the issue motivating this decision?

## Decision

What we decided.

## Alternatives Considered

What else was evaluated and why rejected.

## Consequences

What becomes easier or more difficult.
```
