---
name: plan
description: >
  Plan a feature or change with full knowledge of the opinionated TypeScript architecture and the project's adoption state.
  Conducts a thorough discovery interview to understand domain concerns, bounded contexts, and application services,
  then produces a high-level architectural specification — never concrete implementation details.
  Triggers on phrases like "plan a feature", "design this change", "architect this",
  "help me plan", "what modules do I need", or "think through this feature".
  Also invocable via the /tseng:plan slash command.
---

```!
echo "Architecture docs: ${CLAUDE_SKILL_DIR}/architecture/"
echo "Version: $(cat "${CLAUDE_SKILL_DIR}/VERSION")"
```

# TSEng Plan

Plans features and changes with full knowledge of the opinionated TypeScript architecture and the project's current adoption state. Produces a high-level architectural specification through rigorous discovery — never concrete implementation details.

The output is a specification that gives the implementer architectural guardrails (which modules, which layers, which events, which services etc.) while leaving room for creative decisions about *how* to implement each piece.

## Phase 1 — Load Architecture Overview (Progressive Disclosure)

Read only the overview to start — load specific docs lazily as the interview reveals what's relevant:

1. Read `architecture/index.md` from the architecture docs directory (shown above). This gives you the map of all topics without the full weight.

**Do NOT read all architecture files upfront.** Instead, load them on-demand during the interview:

| When you learn...                              | Then read...                  |
|------------------------------------------------|-------------------------------|
| Which tech stack questions arise                | `stack.md`                    |
| Feature touches layer responsibilities          | `slice-composition.md`        |
| Multiple modules or new module needed           | `modules.md`                  |
| Cross-module communication is involved          | `module-boundaries.md`        |
| Project structure or package layout questions   | `project-structure.md`        |

This keeps context lean. You are the architecture expert — load knowledge just-in-time as the conversation demands it.

## Phase 2 — Load Project State

Read the project's TSEng context to understand where it stands:

1. Check if `tseng/index.md` exists. If it does, read it and follow every link:
   - `tseng/project-structure.md` — package layout, roles, runtimes
   - `tseng/adoption.md` — applied, discarded, and remaining changes
   - `tseng/reviews/index.md` — review history
   - The **latest locked review** — to understand current compliance state
2. Read the project's existing module structure by scanning server package `src/modules/` directories and contract package `src/modules/` directories.
3. Check if `tseng/vocabulary.md` exists. If it does, read it — this is the project's ubiquitous language.

If the project has no `tseng/` directory at all, inform the user they should run `/tseng:adopt` or `/tseng:bootstrap` first. You can still proceed with planning but warn that you lack project-specific context.

Summarize what you found to the user in a brief status:
- How many modules exist and what they are
- Adoption state (how aligned the project is)
- Any relevant discarded decisions that may affect planning

## Phase 3 — Discovery Interview

This is the most critical phase. You must understand the feature deeply before producing any specification. Ask questions **one round at a time** — do not dump all questions at once. Each round should build on the previous answers.

### Round 1 — What and Why

Start with the big picture:
- What is the feature or change? (in the user's words)
- What business problem does it solve?
- Who are the actors? (users, systems, external services)

### Round 2 — Domain Exploration

Dig into the domain:
- What are the core **nouns** (entities, value objects) involved?
- What are the key **verbs** (actions, commands, operations)?
- What **invariants** (business rules) must hold? ("An order can only be cancelled if it hasn't shipped")
- What **states** or **lifecycles** exist? ("A subscription goes from trial → active → cancelled")

Push back on technical answers. If the user says "I need a database table for X" — ask what X *is* in domain terms. If they say "I need an API endpoint" — ask what use case it serves.

### Round 3 — Bounded Context Analysis

Map the feature to the architecture:
- Which **existing modules** (bounded contexts) are affected?
- Does this feature require a **new module**? Apply the three questions from the architecture:
  1. Does this area have its own language?
  2. Can this area change independently?
  3. Does this area have its own invariants?
- Are there concepts that look like the same thing but mean different things in different contexts? (e.g., "User" in Identity vs "Customer" in Billing)

### Round 4 — Layer Classification

For each piece of logic the user has described, classify it:
- **Domain layer** — Pure business rules, invariants, state transitions, value calculations. No side effects.
- **Application layer** — Use case orchestration, transaction boundaries, coordinating domain objects, calling external services.
- **Validation layer** — Input parsing and sanitization only.

Challenge the user when things are in the wrong layer:
- "That sounds like a business rule — it belongs in domain, not in a service"
- "That's orchestration across two entities — that's application layer"
- "Validation of input format is router-level, but validation of business state is domain"

### Round 5 — Inter-Module Communication

If multiple modules are involved:
- What **domain events** need to flow between modules?
- Which module **publishes** each event? Which **subscribes**?
- Is the coupling direction correct? (subscribers depend on publishers, never the reverse)
- Are there any temptations to import across module boundaries that should be events instead?

### Round 6 — Integrations and External Concerns

- Are there external systems (payment providers, email services, third-party APIs)?
- Where do these integrations live? (Application layer — never domain)
- Are there cross-cutting concerns (auth, logging, rate limiting)?

### Adaptive Questioning

These rounds are a guide, not a rigid script. Adapt based on the feature's complexity:
- For simple features (single module, no events), rounds 5-6 may be unnecessary.
- For complex features, you may need additional rounds to disambiguate.
- If the user's answers reveal ambiguity or contradictions, probe deeper before moving on.
- If the user is unsure about something, help them think through it using the architecture's principles.

**Do not proceed to Phase 4 until you are confident you understand the feature's domain model, bounded context boundaries, and layer responsibilities.**

## Phase 4 — Update Ubiquitous Language

Based on the discovery interview, update (or create) `tseng/vocabulary.md`:

```markdown
# Ubiquitous Language

Domain terms used across this project. Each term is scoped to its bounded context.

## [Module Name] (bounded context)

| Term | Definition |
|------|-----------|
| Order | A customer's request to purchase one or more items |
| OrderItem | A line item within an order, referencing a product and quantity |
| ...  | ... |

## [Another Module]

| Term | Definition |
|------|-----------|
| ...  | ... |
```

Rules:
- Only add terms that emerged from the discovery interview.
- Scope every term to its bounded context — the same word may appear in multiple contexts with different definitions.
- Merge with existing content — never lose previously recorded terms.
- Keep definitions concise and domain-focused (no technical details).

Update `tseng/index.md` to include a link to `tseng/vocabulary.md` if not already present:
```markdown
## Ubiquitous Language
See [vocabulary.md](vocabulary.md) for domain terms scoped by bounded context.
```

## Phase 5 — Produce Specification

Write a specification that is **architectural, not implementational**. The specification tells the implementer *what* to build and *where* it belongs — not *how* to write the code.

Present the specification to the user in this structure:

### Feature Overview
One paragraph describing the feature in domain language.

### Affected Bounded Contexts
For each module (existing or new):
- Module name and whether it's new or existing
- What responsibility it has in this feature
- Key domain concepts it owns (entities, value objects, aggregates)
- Key invariants it enforces

### Domain Events
For each cross-module event:
- Event name (past tense, business language: `OrderPlaced`, not `order_created`)
- Publishing module
- Subscribing module(s)
- What the event represents in business terms
- Key data the event carries (conceptual, not schema)

### Application Services
For each use case:
- Service name and which module it belongs to
- What use case it orchestrates
- Which domain concepts it coordinates
- External integrations it touches (if any)

### Layer Responsibilities
A clear breakdown of what lives where:
- **Domain**: business rules, invariants, state transitions
- **Application**: orchestration, external calls, transaction boundaries
- **Validation**: input shapes and constraints

### Coupling Analysis
- How modules interact (events only, no direct imports)
- Dependency direction (subscribers → publishers)
- Any risks of tight coupling and how to avoid them

### What This Specification Does NOT Prescribe
Explicitly call out what is left to the implementer:
- Specific function signatures, class names, or file names
- Database schema or storage decisions
- Error message wording
- UI/UX details
- Performance optimization strategies
- Testing strategy

**Restrain from concrete implementation details.** Short pseudo-code snippets are fine to illustrate domain concepts (e.g., a Result type signature, an event shape), but avoid prescribing exact function names, file paths, or class hierarchies. The implementer must have creative freedom within the architectural boundaries you've defined.

## Phase 6 — Review and Iterate

Present the specification to the user. Ask:
- Does this capture the feature correctly?
- Are the bounded context boundaries right?
- Are there domain concepts missing?
- Is the event flow correct?

Iterate until the user is satisfied. Each iteration should refine, not rewrite.

## Phase 7 — Store as GitHub Issue

Once the user approves the specification, ask if they'd like to store it as a GitHub issue.

If yes:
1. Format the specification as a GitHub issue body (clean markdown, no frontmatter).
2. Use a concise title that captures the feature.
3. Create the issue using `gh issue create`.
4. Report the issue URL to the user.

The issue body should be the specification from Phase 5, formatted for GitHub readability. Include a header noting it was generated by TSEng Plan with the architecture version.

## Guidelines

- **You are the architecture expert.** Push back when the user describes something that violates the architecture. Explain why, using the rules from the architecture docs.
- **Domain-first thinking.** Always start from the domain model and work outward. Never start from technical concerns (APIs, databases, UI).
- **One round at a time.** Don't overwhelm the user with all questions at once. Build understanding incrementally.
- **Challenge layer placement.** If the user describes business logic as "a service that does X" — ask whether X is actually a domain concern. If they describe orchestration as domain — redirect it to application layer.
- **No implementation details.** The specification is a contract between the architect (you) and the implementer. It defines boundaries, not code.
- **Respect existing adoption state.** If the project has discarded certain architecture rules, don't plan features that depend on those rules without flagging the tension.
- **Ubiquitous language matters.** Use the same words the domain uses. If the user says "customer" don't write "user" in the spec. If different contexts use different words for the same real-world thing, that's a feature, not a bug — capture both.
- **Start big, split later.** Prefer fewer, larger modules over many small ones. Only propose a new module when the bounded context criteria are clearly met.
