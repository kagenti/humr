---
name: adr
description: >
  Tracks Architecture Decision Records (ADRs) in docs/adr/.
  Creates, lists, and updates ADRs following an immutable, append-only log.
  TRIGGER when: user wants to record, review, or update an architectural decision.
argument-hint: "new <title> | list | show <number> | status <number> <status>"
---

# ADR Tracking

Manage Architecture Decision Records in `docs/adr/`.

ADRs are immutable and append-only. Once accepted, an ADR is never edited or deleted. To reverse a decision, create a new ADR that deprecates the previous one.

## Commands

Parse the action from `$ARGUMENTS`:

### `new <title>`

1. Read `docs/adr/index.md` to find the highest ADR number.
2. Assign the next number, zero-padded to 3 digits (e.g., `001`).
3. Read the template from `docs/adr/000-template.md`.
4. Create `docs/adr/NNN-<kebab-case-title>.md` with the title filled in and status set to **Proposed**.
5. If the user provided context about the decision, fill in the Context and Decision sections. Otherwise leave placeholders.
6. Append a row to the Records table in `docs/adr/index.md`.
7. Report the created file path.

### `list`

1. Read and display the Records table from `docs/adr/index.md`.

### `show <number>`

1. Find and display the ADR file matching the given number.

### `status <number> <new-status>`

1. Valid statuses: `Proposed`, `Accepted`, `Deprecated`.
2. Update the `## Status` line in the ADR file.
3. Update the status column in `docs/adr/index.md`.
4. Report the change.

## Conventions

- Files: `NNN-kebab-case-title.md` (e.g., `001-use-configmaps-over-crds.md`)
- Numbers: zero-padded to 3 digits
- Template: `docs/adr/000-template.md` — do not modify
- Index: `docs/adr/index.md` — always keep in sync
