# Step 07 — Clean code (types + DRY + naming)

**Goal:** final sweep. No `any` at boundaries, no duplicated classifier / formatter functions, meaningful names, comments only where "why" isn't obvious.

**Skill references:**
- [`references/types.md`](../../../../.agents/skills/react-ui-engineering/references/types.md)
- Core principles 4 + 5 in [`SKILL.md`](../../../../.agents/skills/react-ui-engineering/SKILL.md)

**Preconditions:** all of 01–06 complete for this domain. This step is the polish pass; it assumes the domain is structurally sound.

---

## Scope

1. `any` / untyped response surfaces.
2. Duplicated classification / formatting / validation helpers.
3. Names that carry no intent (`sel`, `h`, `flag`, `Data`, `tmp`).
4. Comments that restate the code; multi-paragraph docstrings; stale comments.
5. Utility functions living in the wrong place (imported across domains but defined inline).

## Recipe

### Replace `any` with Zod-inferred types

For every protocol boundary (WebSocket message handlers, untyped callbacks, external API responses):

1. Define the Zod schema in `modules/{domain}/api/types.ts`.
2. Parse at the boundary: `msg = protocolSchema.parse(incomingJson)`.
3. Export the inferred type: `export type Msg = z.infer<typeof protocolSchema>`.
4. Replace every `any` downstream with the inferred type.

Protocol surfaces historically typed `any` include: ACP update handlers, permission-prompt payloads, config-update callbacks. Each becomes a discriminated union.

### Narrow with guards, not `as`

Anti-pattern:

```ts
const agent = item as Agent;
```

Preferred:

```ts
if (!isAgent(item)) return null;
// item: Agent here
```

Use `as` only when a type guard genuinely cannot express the narrowing; add a one-line comment explaining why.

### Deduplicate classifiers / formatters

Grep for sibling implementations:

```sh
grep -rn "function classify\|const classify\|function displayName\|const displayName" src/
```

If the domain file has a local `classify(s)` and `types.ts` already exports `isMcpSecret()`, delete the local one. If both live locally, hoist the canonical one to `modules/{domain}/utils.ts` or `src/utils/` depending on scope.

### Rename for intent

Walk through the domain's identifiers. Replace:

- `sel` → `selectedAgentId`
- `h` / `handle` → `handleSubmit`, `handleClick`
- `flag` → `hasPendingChanges`, `isOpen`, `shouldRetry`
- `Data` → `Agent`, `Connection`, `Session`
- `tmp` → whatever it actually is
- `calc` → `calculateMonthlyTotal`

A well-named identifier removes the need for its explanatory comment.

### Prune comments

Delete:
- Comments that restate the next line.
- Multi-paragraph docstrings on obvious functions.
- `// TODO` items that are already tickets or already stale.
- Comments explaining *what*; keep only those explaining *why*.

Keep one-line comments only for:
- Non-obvious invariants ("must run before X fires").
- Workarounds tied to a specific upstream bug (link the issue).
- Constraints from an external system ("Chrome throttles this below 1s").

### Utility placement

If a utility is used in exactly one domain, it lives in that module. If ≥2 domains use it, promote it to `src/utils/`. Don't promote speculatively.

## Definition of done

- `grep -rn ": any\b" src/modules/{domain}/` → zero hits (or each remaining hit has a one-line comment justifying it).
- No duplicated classifiers / formatters visible by greping the domain + `src/types.ts` + `src/utils/`.
- No single-letter or meaningless identifiers remaining.
- No comments that restate code.
- `mise run check` green.

## How to verify

1. **`mise run check`** — must pass (type-check catches any regressions from `as` removal).
2. **Grep sweep:**
   - `grep -rn ": any\b" src/modules/{domain}/`
   - `grep -rn " as [A-Z]" src/modules/{domain}/` — each remaining hit justified by a comment.
3. **Self-review pass** — read every file in the domain top-to-bottom. Intent should be obvious without comments in 95%+ of cases.
4. **Playwright or user test** — full domain regression. This is the last step before a domain ships fully refactored; spend the time on a thorough pass, not just a smoke check.
