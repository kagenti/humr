---
name: draft-issue
description: >
  Template and writing guidelines for a GitHub issue that defines a problem and proposes a high-level solution from the user's perspective, with no implementation details. Produces a draft only — does not file.
  TRIGGER when: user wants to draft, outline, or shape a GitHub issue / ticket.
argument-hint: "[what the issue is about]"
---

# Draft an Issue

Produce a GitHub issue that reads like a product ticket, not an engineering plan. The reader should understand **what problem exists** and **what the user-visible outcome of fixing it looks like** — nothing more.

This skill is opinion about *what an issue looks like*, not *how you get there*. No workflow, no approval step, no filing. Use the `file-issue` skill when you also want the draft → approve → file loop.

## What to include

- **Title** — short, declarative, no jargon. Names the change, not the component.
- **Problem** — what's wrong or missing today, from the user's point of view. Include a concrete scenario if it sharpens the problem. Explain *why it matters* — what does the user currently have to do, or fail to do, because of this gap.
- **Proposed solution** — the high-level shape of the fix, described as user-visible behavior ("the agent can do X", "the UI shows Y"). Not the mechanism.
- **Optional subsections**, only when they add signal:
  - **Scope** — boundaries of the change (what it does and does *not* cover).
  - **Transparency / safety** — anything the user needs to see or control for trust.
  - **Dependencies** — blocked on / blocks other issues (reference by `#NNN`).
  - **Out of scope** — things a reader will reasonably wonder about, deferred with a brief reason.

## What to exclude

Strip all of these before presenting the draft:

- File paths, line numbers, function/class names, module names.
- Code snippets, schema definitions, type signatures.
- Specific API endpoints, database tables, config keys, env var names.
- Proposals about *how* to implement (which service handles what, what data structure to use, which library to add).
- Naming of internal components unless they're already user-facing terms.

Rule of thumb: if a reader would need to know the codebase to understand a sentence, rewrite or remove it. The issue should make sense to a PM, a designer, or a new contributor who's never opened the repo.

## Style

- Prefer plain language over precise language. "Schedules" not "AgentSchedule ConfigMaps."
- Short paragraphs. Bulleted lists when enumerating distinct things.
- Bold the key noun in a bullet when it introduces a concept (e.g. "**heartbeat** — a recurring self-scheduled check").
- It's fine to flag open questions or naming uncertainty — invite the reader to push back.
- Concise but complete. If a subsection has nothing to say, cut it.

## Template

```markdown
**Title:** <short, declarative>

## Problem

<What's wrong or missing today, from the user's perspective. A concrete scenario if it helps. Why it matters.>

## Proposed solution

<The user-visible shape of the fix. High-level, no mechanism.>

### Scope
<optional — boundaries>

### Dependencies
<optional — Blocked on #NNN, blocks #NNN>

### Out of scope
<optional — deferred things, with a one-line reason each>
```
