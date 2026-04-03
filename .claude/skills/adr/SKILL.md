---
name: adr
description: >
  Tracks Architecture Decision Records (ADRs) in docs/adr/.
  Creates, lists, and updates ADRs following an immutable, append-only log.
  TRIGGER when: user wants to record, review, or update an architectural decision.
argument-hint: "[what you'd like to do]"
---

# ADR Tracking

Manage Architecture Decision Records in `docs/adr/`.

ADRs are immutable and append-only. Once accepted, an ADR is never edited or deleted. To reverse a decision, create a new ADR that deprecates the previous one.

## Behavior

Interpret `$ARGUMENTS` as natural language. Determine the user's intent and follow the matching workflow below.

### Creating an ADR

When the user wants to record a new decision:

1. Ask the user for any missing information. You need at minimum:
   - **Title**: a short name for the decision
   - **Context**: what problem or situation motivates this decision?
   - **Decision**: what is being decided?
2. Optionally ask about **Consequences** — what trade-offs or impacts does this have?
3. Once you have enough information:
   a. Read `docs/adr/index.md` to find the highest ADR number.
   b. Assign the next number, zero-padded to 3 digits (e.g., `001`).
   c. Read the template from `docs/adr/000-template.md`.
   d. Create `docs/adr/NNN-<kebab-case-title>.md` with the sections filled in and status set to **Proposed**.
   e. Append a row to the Records table in `docs/adr/index.md`.
   f. Show the user the created ADR and its file path.

### Listing ADRs

When the user wants to see existing ADRs:

1. Read and display the Records table from `docs/adr/index.md`.

### Showing an ADR

When the user wants to read a specific ADR:

1. Find and display the ADR file matching the number or title the user mentioned.

### Updating ADR status

When the user wants to accept or deprecate an ADR:

1. Confirm which ADR and what the new status should be.
2. Valid statuses: `Proposed`, `Accepted`, `Deprecated`.
3. Update the `## Status` line in the ADR file.
4. Update the status column in `docs/adr/index.md`.
5. Report the change.

### Ambiguous requests

If the user's intent is unclear, ask a clarifying question rather than guessing.

## Conventions

- Files: `NNN-kebab-case-title.md` (e.g., `001-use-configmaps-over-crds.md`)
- Numbers: zero-padded to 3 digits
- Template: `docs/adr/000-template.md` — do not modify
- Index: `docs/adr/index.md` — always keep in sync
