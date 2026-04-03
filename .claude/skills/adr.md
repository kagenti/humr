---
name: adr
description: Create, list, or update Architecture Decision Records (ADRs) in docs/adr/
user_invocable: true
---

# ADR Tracking Skill

Manage Architecture Decision Records in `docs/adr/`.

## Instructions

When the user invokes `/adr`, determine the action from their arguments:

### `/adr new <title>` — Create a new ADR

1. Read `docs/adr/index.md` to find the highest existing ADR number.
2. Assign the next sequential number (zero-padded to 3 digits, e.g., `001`).
3. Read the template from `docs/adr/000-template.md`.
4. Create `docs/adr/NNN-<kebab-case-title>.md` using the template, replacing `NNN` with the assigned number and filling in the title. Set status to **Proposed**.
5. If the user provided context about the decision, fill in the Context and Decision sections. Otherwise leave the placeholder text for the user to complete.
6. Update `docs/adr/index.md` — add a row to the Records table with the new ADR number, title, and status.
7. Report the created file path.

### `/adr list` — List all ADRs

1. Read `docs/adr/index.md` and display the Records table to the user.

### `/adr status <number> <new-status>` — Update ADR status

1. Valid statuses: `Proposed`, `Accepted`, `Deprecated`, `Superseded by ADR-NNN`.
2. Update the `## Status` line in the ADR file.
3. Update the status column in `docs/adr/index.md`.
4. Report the change.

### `/adr show <number>` — Show an ADR

1. Read and display the ADR file matching the given number.

## Conventions

- Files are named `NNN-kebab-case-title.md` (e.g., `001-use-configmaps-over-crds.md`).
- Numbers are zero-padded to 3 digits.
- The template lives at `docs/adr/000-template.md` and should not be modified.
- `docs/adr/index.md` is the single index of all ADRs — always keep it in sync.
