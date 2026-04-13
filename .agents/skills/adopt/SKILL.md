---
name: adopt
description: >
  Adopt the opinionated TypeScript architecture in an existing project.
  Runs a review first, then proposes incremental changes the user can accept or discard.
  Remembers discarded proposals so they aren't re-suggested.
  Triggers on phrases like "adopt the architecture", "migrate my project",
  "align my project with the rules", "adopt tseng", or "make my project conform".
  Also invocable via the /tseng:adopt slash command.
---

```!
echo "Architecture docs: ${CLAUDE_SKILL_DIR}/architecture/"
echo "Version: $(cat "${CLAUDE_SKILL_DIR}/VERSION")"
```

# TSEng Adopt

Incrementally adopts the opinionated TypeScript architecture in an existing project. Unlike bootstrap (greenfield only), adopt works with existing code and lets the user control which changes to apply. Produces an **immutable review record** that is locked once the user finalizes their decisions.

## Phase 1 — Get Version

The current tseng version is shown above (injected from the VERSION file). This version is embedded in the review record.

## Phase 2 — Generate Checklist & Create Review Record

Run the full review process to understand the current state:

1. Read `architecture/index.md` from the architecture docs directory (shown above).
2. Read every file linked from the index (in the same architecture docs directory).
3. Extract every concrete, verifiable rule into a checklist. Do not include `tseng/` files (index.md, project-structure.md, adoption.md, reviews/) in the checklist — those are outputs of the adopt process, not rules to audit.

Determine the next review number by reading `tseng/reviews/index.md` (or starting at `001`).

Write the checklist to `tseng/reviews/NNN.md`:

```markdown
# Review #NNN

<!-- tseng_version: {version} -->
<!-- status: open -->
<!-- created: {YYYY-MM-DD} -->

Generated from architecture docs (tseng v{version}).

## Stack
- [ ] Uses tRPC for API layer
- [ ] ...

## Architecture
- [ ] ...
```

Update `tseng/reviews/index.md` with the new row (status: `open`). Never modify existing rows.

## Phase 3 — Audit via Subagent

Launch a subagent to audit every checklist item (same as review skill).

Use this exact subagent prompt template:

```
You are auditing a TypeScript project at {project_path} against a checklist of architecture rules.

Go through EVERY item below. For each one:
- Check the project files to determine if the rule is satisfied
- Mark it ✅ (pass) or ❌ (fail) or ⚠️ (partially met / not applicable)
- Cite the specific file and line that proves your assessment
- If it fails, briefly say what's wrong

Do NOT check anything beyond this list. Do NOT add suggestions, improvements, or opinions. Only verify what's listed.

CHECKLIST:
{checklist_contents}
```

## Phase 4 — Load Adoption State

Check if `tseng/adoption.md` exists in the target project. If it does, read it. This file tracks previously discarded proposals — any violation listed there under `## Discarded` must NOT be re-proposed.

## Phase 5 — Propose Changes

From the audit results, collect all ❌ and ⚠️ items that are NOT in the discarded list. Group them into concrete change proposals:

Present proposals to the user as a numbered list. Each proposal should include:
- The rule being violated
- What needs to change (specific files/directories)
- Rough scope of the change (one-liner)

Ask the user which proposals to **accept** and which to **discard**. The user can respond with numbers, ranges, "all", or "none".

For any discarded proposals, ask the user for a **brief reason** (e.g., "will cover this later", "using a different pattern intentionally", "not relevant for this project"). This context is recorded in `adoption.md` so future runs (especially upgrade) can understand *why* something was rejected, not just *that* it was.

## Phase 6 — Apply Accepted Changes

For each accepted proposal, make the actual code changes. Follow the architecture docs as the source of truth.

After applying changes:
- Write or update `tseng/project-structure.md` with project metadata.
- Write or update `tseng/adoption.md` (see Phase 8).
- Write or update `tseng/index.md` using the template from the architecture docs. Include sections for all files that now exist in `tseng/`.

## Phase 7 — Lock the Review Record

Now that the user has finalized their decisions, update the review record `tseng/reviews/NNN.md`:

1. Mark each checklist item based on the final state:
   - `[x]` — rule satisfied (passed audit or was just applied)
   - `[ ]` — rule not satisfied (user discarded the proposal or it remains unaddressed)
2. Update the metadata:
   ```
   <!-- status: locked -->
   <!-- locked: {YYYY-MM-DD} -->
   ```
3. Update the corresponding row in `tseng/reviews/index.md` to show `locked` status.

**Once a review is locked, it must NEVER be modified again.** It is a permanent record of the project's state at that point in time.

## Phase 8 — Update Adoption State

Write `tseng/adoption.md` with the current state:

```markdown
# Adoption State

## Applied
- [rule description] — applied on [date] (review #NNN)
- ...

## Discarded
- [rule description] — discarded on [date] (review #NNN)
  > Reason: [user-provided context, e.g. "will adopt after auth migration"]
- ...

## Remaining
- [rule description]
- ...
```

Merge with any existing content — don't lose previously recorded items. Include the review number so each decision is traceable. Every discarded entry must include the user's reason on the line below — this context is critical for future upgrade runs to judge whether a re-proposal is warranted.

## Phase 9 — Update Project CLAUDE.md

Ensure the project's root `CLAUDE.md` includes a reference to `tseng/index.md` so future Claude sessions pick up adoption context. If `CLAUDE.md` doesn't exist, create it. If it exists, append only if the reference is missing.

Add this block:

```markdown
## TSEng

This project follows the [TypeScript Engineering](tseng/index.md) architecture.
```

## Guidelines

- Existing projects only — if the directory is empty, suggest using the `bootstrap` skill instead.
- Never re-propose discarded items. The user said no; respect it.
- Apply changes incrementally. Don't rewrite the entire project in one shot.
- The architecture docs are the source of truth — don't deviate from them.
- The server runtime is pluggable (Hono or Express). Accept either as valid.
- Package names are flexible. Never propose renaming packages to match a convention — discover what the project calls its server/client packages and record them in `tseng/project-structure.md` with the correct role. A project may have multiple server and client packages.
- Packages outside the scope of this architecture (e.g., different language, infra tooling) should be recorded with `role: other` and not audited.
- If the project doesn't use tRPC/Zod at all, propose adding them as the first step rather than trying to restructure everything at once.
- Adoption is iterative — the user can run `/tseng:adopt` multiple times. Each run produces a new review record.
- Review records are **immutable once locked**. Never modify a previously locked review file. Always create a new record for new runs.
