# Domain — secrets

Standalone secret management (the non-agent-scoped surface — agent-scoped secrets live in the agents domain's `edit-agent-secrets-dialog`).

## Files in scope

- `src/dialogs/edit-secret-dialog.tsx` — create/edit a secret.
- `src/components/env-mappings-editor.tsx` — env mapping rows.
- `src/components/env-vars-editor.tsx` — env var rows.
- `src/components/key-value-editor.tsx` — generic key-value UI (may be a primitive — check step 01).
- `src/store/secrets.ts` — zustand slice with `fetchSecrets()` (removed in step 03).

Target module: `src/modules/secrets/`.

If `key-value-editor.tsx` is consumed by ≥2 other domains, it's a top-level primitive, not a secrets file. Decide in step 01.

## Known specifics

- `edit-secret-dialog.tsx` has a fetch-in-component triad for loading existing secrets. Step 02 replaces with `useSecret(id)`.
- `fetchSecrets` in the slice is called from multiple places. Step 02 + 03 collapse this to `useSecrets()` (TQ).
- Env mapping validation (regex for env-var name shape) should become a Zod schema in step 05.

## Step checklist

| Step | Focus | PR |
|---|---|---|
| 01 structure | classify key-value-editor as primitive or secrets-specific | |
| 02 data | list + CRUD via TQ; typed fetchers if any REST bits | |
| 03 state | drop `fetchSecrets`, drop server-state fields | |
| 04 splitting | dialog should already be reasonable; verify row components | |
| 05 forms | RHF + Zod (≥3 fields, validation on env-var name) | |
| 06 styling | row styling, delete-confirm affordances | |
| 07 clean | dedupe env-var regex validation across mapping editor | |

## Smoke flow (verification)

1. Create a secret → list shows it.
2. Edit → save → changes reflected.
3. Invalid env-var name (lowercase) → validation error shown inline before save.
4. Delete → removed from list; any agent consuming it shows the expected broken-reference state.

**Automation:** Playwright for CRUD + validation. Easiest domain to automate — minimal interactions.
