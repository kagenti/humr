# Step 01 — Project structure

**Goal:** move the domain's code into `src/modules/{domain}/` per the target layout, so later steps operate on a stable shape.

**Skill reference:** [`references/project-structure.md`](../../../../.agents/skills/react-ui-engineering/references/project-structure.md).

**Preconditions:** none. This is always the first step for a domain.

---

## Scope

Within the target domain, identify every file belonging to it across:
- `src/components/` (domain-specific pieces only; primitives stay)
- `src/dialogs/`
- `src/views/`
- `src/panels/`
- `src/hooks/` (domain-specific hooks; generic ones stay)
- `src/store/` (the domain's slice file)

Create `src/modules/{domain}/` with the submodule layout:

```
src/modules/{domain}/
├── api/         # fetchers + query/mutation hooks (populated in step 02)
├── components/  # UI pieces for this domain
├── hooks/       # domain hooks (e.g., feature hooks, derived state)
├── store.ts     # zustand slice if the domain still owns one (trimmed in step 03)
└── types.ts     # domain types (may re-export Zod-inferred types from api/)
```

Only create subfolders you actually need. An empty `api/` is fine — step 02 fills it.

## Recipe

1. List every file involved: grep for domain identifiers (`connection`, `session`, `agent`, ...) across the folders above.
2. Move files with `git mv` — preserves history. Do not rename files in this step.
3. Update imports. Keep `.js` extensions on relative paths. Don't introduce path aliases.
4. Split the shared `store.ts` only if the domain has its own slice file already — move the slice file into the module; the root `store.ts` still combines slices.
5. Primitives (`modal.tsx`, `button.tsx`, `status-indicator.tsx`, `toast-overlay.tsx`, `markdown.tsx`, icons) stay in top-level `components/`. If uncertain, check: does more than one domain import it? → primitive.
6. Generic hooks (`use-auto-resize.ts`, `use-media-query.ts`, etc.) stay in top-level `hooks/`.

## Definition of done

- All of the domain's files live under `src/modules/{domain}/` (with the exception of primitives and generic hooks explicitly left at the top level).
- `mise run check` is green.
- No behaviour change — the app looks and acts identical.
- The domain's cell in the progress matrix moves to ✅.

## How to verify

1. **`mise run check`** — lint + type-check all packages. Must pass.
2. **App boots** — `mise run ui:run` and the affected views render. No console errors on initial load.
3. **Smoke check the domain's primary flow** — see the domain file's "Smoke flow" section. Playwright if the domain file has a script, otherwise one-minute user test.

Because this step is purely mechanical, visual regression is the only real risk: a missed import or a circular-import introduced by the move. Both surface at build or boot time.
