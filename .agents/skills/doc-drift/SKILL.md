---
name: doc-drift
description: >
  Detect drift between code changes and documentation. Inspects a PR, branch, or local diff
  against the project's documentation guidelines (`docs/guidelines/documentation-guidelines.md`)
  and flags places where docs no longer match the code — missing architecture-page updates,
  stale `Last verified:` dates, undeclared ADRs, vocabulary gaps, broken cross-references.
  Triggers on phrases like "doc drift", "docs drift", "are the docs in sync", "check
  documentation drift", "do the docs need updating", or "documentation review".
  Also invocable via the `/doc-drift` slash command.
---

# Doc Drift

Reviews code changes against the project's documentation. The contract is the **drift rule**
in [`docs/guidelines/documentation-guidelines.md`](../../../docs/guidelines/documentation-guidelines.md):

> When your work changes the behavior or responsibility of a subsystem, update its page in the same PR.

This skill operationalizes that rule. It reads the diff, reads the docs, and reports
mismatches. It does **not** rewrite docs — fixes are proposed, the user decides.

## What this skill checks

The documentation guidelines define several explicit rules. Each becomes a drift check:

1. **Architecture-page drift** — if the change alters behavior or responsibility of a subsystem,
   the corresponding page under [`docs/architecture/`](../../../docs/architecture/) must be
   updated in the same PR. Subsystems are listed in [`docs/architecture.md`](../../../docs/architecture.md).
2. **`Last verified:` staleness** — every architecture page edited in the diff must have its
   `Last verified: YYYY-MM-DD` header bumped to the PR date.
3. **`Motivated by:` accuracy** — if the change realizes a new ADR or breaks the realization of
   a listed one, the `Motivated by:` list on the affected page must be updated.
4. **ADR coverage** — if the change embodies an architectural decision (new component, changed
   protocol, new persistence substrate, new trust boundary, …) there should be an ADR under
   [`docs/adrs/`](../../../docs/adrs/) — either pre-existing or filed in the same PR.
5. **Vocabulary drift** — new domain terms introduced in code should appear in
   [`tseng/vocabulary.md`](../../../tseng/vocabulary.md). Docs follow the code.
6. **Cross-reference rot** — if a doc was moved/renamed/deleted, every inbound link from other
   docs, `CLAUDE.md`, `README.md`, and code comments must be updated.
7. **Volatile content leak** — if a doc was edited to *add* exact package names, file paths,
   Helm template tree, or library-level choices below framework level, that is drift toward
   volatility (the guidelines forbid it). Link out instead.
8. **New subsystem without a page** — if the change introduces a new long-lived component
   (controller, daemon, gateway, …) it needs a new page under `docs/architecture/` linked from
   the landing page.

## Report

Take the subagent's output and present a focused report to the user:

- **Verdict** — one line: `aligned`, `minor drift`, or `significant drift`.
- **Drift** — every ❌, with file/line evidence and the proposed edit. Group by check number.
- **Possible drift** — every ⚠️, with the human-judgement question that needs answering.

## Guidelines

- **Read-only by default.** Do not edit docs unless the user accepts the proposed fixes.
- **The documentation guidelines are the sole rulebook.** Do not invent rules. Do not flag things
  the guidelines don't forbid (e.g., short architecture pages — there is no length cap).
- **Trivial changes are exempt.** README typos, comment-only edits, dependency bumps with no
  behavior change, lint fixes, and test-only changes do not trigger doc drift. Don't report.