---
name: build-it
description: >
  Implement an architectural specification as working code. Takes the output of the spec skill
  (from a GitHub issue, conversation context, or pasted text) and produces working TypeScript code
  following the project's established conventions and the architecture rules.
  Triggers on phrases like "build this spec", "implement this spec", "build it",
  "implement the feature", "code this up", or "turn this spec into code".
  Also invocable via the /tseng:build-it slash command.
---

```!
echo "Architecture docs: ${CLAUDE_SKILL_DIR}/architecture/"
echo "Version: $(cat "${CLAUDE_SKILL_DIR}/VERSION")"
```

# TSEng Build-It

Implements an architectural specification as working code. Takes a spec produced by the spec skill (from a GitHub issue, conversation context, or pasted text) and translates it into concrete TypeScript modules, services, domain objects, events, and routers — following the project's existing conventions and the architecture rules.

The spec defines *what* to build and *where* it belongs. This skill decides *how* to build it.

## Phase 1 — Load Architecture Overview (Progressive Disclosure)

Read only the overview to start — load specific docs lazily as implementation demands:

1. Read `architecture/index.md` from the architecture docs directory (shown above). This gives you the map of all topics without the full weight.

**Do NOT read all architecture files upfront.** Instead, load them on-demand during implementation:

| When you need to...                              | Then read...                  |
|--------------------------------------------------|-------------------------------|
| Understand stack/dependency requirements         | `stack.md`                    |
| Implement layer code (routers, services, domain) | `slice-composition.md`        |
| Create or modify modules                         | `modules.md`                  |
| Wire cross-module events                         | `module-boundaries.md`        |
| Place files or create new packages               | `project-structure.md`        |

This keeps context lean. You are the architecture expert — load knowledge just-in-time as the implementation demands it.

## Phase 2 — Load Project State

Read the project's TSEng context to understand where it stands:

1. Check if `tseng/index.md` exists. If it does, read it and follow every link:
   - `tseng/project-structure.md` — package layout, names, paths, server runtime
   - `tseng/adoption.md` — applied, discarded, and remaining changes
   - `tseng/reviews/index.md` — review history
   - The **latest locked review** — to understand current compliance state
2. Read the project's existing module structure by scanning server package `src/modules/` directories and contract package `src/modules/` directories.
3. Check if `tseng/vocabulary.md` exists. If it does, read it — this is the ubiquitous language that the spec was written against. Use these exact terms throughout implementation.

If the project has no `tseng/` directory at all, warn the user that project context is missing and suggest running `/tseng:adopt` first. Do not refuse to proceed — the user may have a good reason — but warn that implementation decisions will be less informed.

Summarize what you found to the user in a brief status:
- How many modules exist and what they are
- Adoption state (how aligned the project is)
- Server runtime and package layout
- Any discarded decisions that may affect implementation

## Phase 3 — Obtain the Specification

Ask the user how they want to provide the spec:

> How would you like to provide the specification?
> 1. **GitHub issue** — give me the issue number or URL
> 2. **From this conversation** — if you just ran /tseng:spec
> 3. **Paste it** — paste the spec text directly

For option 1: Use `gh issue view <number> --json body,title` to fetch the issue. Parse the markdown body to extract the spec sections.

For option 2: Look back in the conversation for the spec output from a prior /tseng:spec invocation. If not found, tell the user and ask for an alternative.

For option 3: Accept the pasted text.

**Validate the spec.** Confirm it contains at minimum:
- Feature Overview
- Affected Bounded Contexts

If sections are missing, ask the user if this is intentional or if the spec is incomplete. A spec without "Domain Events" is valid (single-module feature), but a spec without "Affected Bounded Contexts" is not actionable.

Summarize what you understand from the spec back to the user:
- Which modules will be created or modified
- What events will be wired
- What services will be implemented
- Any areas the spec leaves open that you'll need to decide on

## Phase 4 — Create Implementation Plan

This is where the spec's "what and where" becomes concrete "how". Before writing the plan, discover the project's existing conventions.

### Convention Discovery

Scan existing code in the project for patterns:
- How are existing entities structured? (classes vs plain types + functions)
- How are Result types implemented? (custom type, neverthrow, ts-results, etc.)
- How are services structured? (classes with DI, plain functions, factory functions)
- How are tRPC routers composed? (single router per module, nested routers, etc.)
- How is tRPC context set up? (what's available for DI)
- Naming conventions (camelCase files, PascalCase files, kebab-case files)

If the project has no existing modules, follow the architecture docs' example patterns as the baseline.

### Plan Structure

For each module in the spec, produce a plan that covers:

1. **File structure** — Every file to be created or modified, with full path:
   ```
   modules/<name>/
     domain/
       <EntityName>.ts
       events/<EventName>.ts
     services/<ServiceName>.ts
     routers/<RouterName>.ts
     index.ts
   ```

2. **Domain layer** — Entity names, value object names, aggregate roots. Key type signatures. Invariant enforcement strategy. Event type definitions (the `type` discriminant and payload shape).

3. **Application layer** — Service function names and parameters. Which domain objects each service coordinates. External integration points. How events are published.

4. **Validation layer** — Router procedure names (query/mutation). Zod schema shapes. How domain errors map to tRPC error codes.

5. **Cross-module wiring** — What gets exported from `index.ts`. Event subscription setup. Import paths for cross-module event types.

Present the plan to the user:

> Does this implementation plan look right? Any naming preferences or conventions I should follow differently?

**Wait for confirmation before proceeding.** This is the single approval gate — once the plan is approved, implementation proceeds without interruption.

## Phase 5 — Implement Module by Module

Work through the plan one module at a time, in dependency order:
- Implement modules that **publish** events before modules that **subscribe** to them
- Within each module, implement bottom-up: **domain first, then services, then routers, then index.ts**

### For each module:

**Step 1 — Domain layer:**
- Create entity types, value objects, aggregate roots
- Implement invariant enforcement (validation functions, state transition guards)
- Use Result types for domain errors — match the project's existing Result pattern
- Create domain event type definitions in `domain/events/`
- Create type guards for each event (`is<EventName>` functions)

**Step 2 — Application layer:**
- Create service functions that orchestrate domain operations
- Wire up dependency injection via function parameters (or constructor injection if the project uses classes)
- Implement event publishing (call the event bus/emitter with the domain events)
- Handle external integrations at this layer

**Step 3 — Validation layer:**
- Create tRPC router with Zod input schemas
- Map each use case from the spec to a tRPC procedure (query for reads, mutation for writes)
- Translate domain Result errors into tRPC error responses
- Wire the router into the module's service via tRPC context

**Step 4 — Module boundary:**
- Create/update `index.ts` exporting only event types and type guards
- Nothing else leaves the module boundary

**Step 5 — Integration:**
- Register the module's router with the app router (update the root router composition)
- Wire event subscriptions in subscribing modules
- Update tRPC context if new services need injection

After each module, briefly report what was created:
> Module `orders` implemented: 3 domain types, 2 events, 1 service, 1 router, index.ts exports wired.

## Phase 6 — Verify Implementation

Run three checks:

**1. Type check** — Run `tsc --noEmit` (or the project's equivalent type-check script). If it fails, fix the type errors. Report what was fixed.

**2. Architecture rule check** — For each newly created/modified file, verify:
- Domain files import nothing from services or routers
- Service files import nothing from routers
- No cross-module imports bypass `index.ts`
- Module `index.ts` exports only event types and type guards
- If violations are found, fix them and report.

**3. Spec coverage check** — Walk through the spec section by section and confirm every element was implemented:
- Every module listed in "Affected Bounded Contexts" has corresponding code
- Every domain event listed in "Domain Events" has a type definition, type guard, and is exported
- Every application service listed in "Application Services" exists with the described use cases
- Every invariant listed under bounded contexts is enforced in domain code

Report the verification results to the user. If anything is missing or broken, fix it.

## Phase 7 — Summary

Present a final summary:

**Created/Modified files:** (grouped by module)

**Modules implemented:**
- For each module: what domain concepts, events, services, and routes were created

**Cross-module wiring:**
- Event flow (publisher → event → subscriber)

**Conventions followed:**
- Note any naming conventions, patterns, or project-specific decisions that were made

**Next steps the user should consider:**
- Testing (the spec doesn't prescribe testing strategy — the user should add tests)
- Database/storage integration (if the spec mentioned persistence needs)
- Any TODO comments left in code where external integration details were unknown

## Guidelines

- **The spec is the contract.** Implement everything in the spec. Do not add features the spec doesn't mention. Do not skip features the spec does mention. If something in the spec is ambiguous, ask.
- **Domain first, always.** Within each module, write domain code before services, services before routers. This ensures the inner layers are stable before the outer layers depend on them.
- **Follow existing conventions.** If the project already has modules, match their style exactly — naming, structure, patterns. Consistency trumps personal preference.
- **The architecture docs are the source of truth** for structural rules (layer dependencies, module boundaries, event patterns). Never violate them, even if existing code does.
- **Respect adoption state.** If `tseng/adoption.md` shows certain rules were discarded, do not enforce those rules in new code. Follow what the project has actually adopted.
- **Respect ubiquitous language.** Use the exact terms from `tseng/vocabulary.md` and the spec. If the spec says "Order", write `Order`, not `Purchase`. If the spec says "OrderPlaced", the event is `OrderPlaced`, not `OrderCreated`.
- **Result types for domain errors.** Never throw exceptions from domain code. Use the project's Result type pattern. If no pattern exists, define a simple `Result<T, E> = { ok: true; value: T } | { ok: false; error: E }` discriminated union.
- **Pure domain layer.** Zero external dependencies in domain code. No framework imports, no I/O, no side effects. Domain functions are pure and deterministic.
- **Events are the only cross-module contract.** When wiring subscribers, import only from the publishing module's `index.ts`. Never reach into another module's internals.
- **Don't invent infrastructure.** If the spec mentions domain events but the project has no event bus, create the simplest possible in-memory event emitter. Do not add message queues, event stores, or other infrastructure the spec doesn't call for.
- **Leave TODOs for unknowns.** If the spec references an external integration but doesn't detail the API, implement the service function with a clear TODO and a placeholder that shows the expected interface.
- **No tests unless asked.** The spec explicitly leaves testing strategy to the implementer. Don't generate tests unless the user asks. If they do ask, follow the project's existing test patterns.
- **Dependency order matters.** Implement publisher modules before subscriber modules. This ensures event types are available when subscribers need to import them.
- **Start big, split later.** If the spec is large, implement the core module first. Get the domain model right before wiring integrations and events.
