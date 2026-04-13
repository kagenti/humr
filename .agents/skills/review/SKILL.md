---
name: review
description: >
  Review an existing TypeScript project against the opinionated architecture rules.
  Use when the user asks to review, audit, check, or validate their project's architecture.
  Triggers on phrases like "review my project", "check the architecture",
  "audit my code structure", "validate my project", or "does my project follow the rules".
  Also invocable via the /tseng:review slash command.
---

```!
echo "Architecture docs: ${CLAUDE_SKILL_DIR}/architecture/"
echo "Version: $(cat "${CLAUDE_SKILL_DIR}/VERSION")"
```

# TSEng Review

Audits an existing TypeScript project against the architecture rules using a two-phase approach to prevent hallucination. Each review produces an **immutable record** appended to `tseng/reviews/`.

## Phase 1 — Get Version

The current tseng version is shown above (injected from the VERSION file). This version is embedded in the review record so every checklist is traceable to the architecture revision that produced it.

## Phase 2 — Generate Checklist

You (the main agent) generate a strict checklist from the architecture docs.

1. Read `architecture/index.md` from the architecture docs directory (shown above).
2. Read every file linked from the index (in the same architecture docs directory).
3. Extract every concrete, verifiable rule from the docs. Each rule becomes a checklist item.

### Checklist rules

- **ONLY** include rules explicitly stated in the architecture docs. Do not infer, extrapolate, or add "best practices" that aren't written down.
- Do not include `tseng/` files (index.md, project-structure.md, adoption.md, reviews/) as checklist items — those are generated outputs, not architecture rules.
- Each item must be verifiable by reading files (checking imports, config values, directory structure, etc.)
- Use the exact terminology from the docs.
- Group items by source file (Stack, Architecture, Project Structure).

## Phase 3 — Assign Review Number & Write Record

Determine the next review number:

1. Check if `tseng/reviews/index.md` exists in the target project. If it does, read it to find the highest existing review number.
2. If no index exists, the next number is `001`.
3. Otherwise increment: if the last review is `003`, the next is `004`.

Write the checklist to `tseng/reviews/NNN.md` using this format:

```markdown
# Review #NNN

<!-- tseng_version: {version} -->
<!-- status: open -->
<!-- created: {YYYY-MM-DD} -->

Generated from architecture docs (tseng v{version}).

## Stack
- [ ] Uses tRPC for API layer
- [ ] Uses Zod for input validation
- [ ] TypeScript strict mode enabled (`strict: true` in tsconfig)
- ...

## Architecture
- [ ] ...

## Project Structure
- [ ] ...
```

The `status` is always `open` for review — the review skill is read-only and does not lock records. Only adopt and upgrade lock records.

## Phase 4 — Update Reviews Index

Write or update `tseng/reviews/index.md`:

```markdown
# Review History

| # | Date | TSEng Version | Status |
|---|------|---------------|--------|
| [001](001.md) | 2026-04-12 | 1.0.0 | open |
```

Append the new row. Never modify existing rows.

## Phase 5 — Audit via Subagent

Launch a subagent (using the Agent tool) to perform the actual audit. The subagent prompt must:
- Include the full contents of the generated checklist (copy-paste it into the prompt)
- Tell the subagent the project root path
- Instruct the subagent to go through each checklist item, check pass/fail, and cite specific files/lines as evidence
- **Do NOT include architecture docs, skill context, or any other instructions in the subagent prompt**

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

## Phase 6 — Report

Take the subagent's output and present the final report to the user:
- **Summary** — one-line overall assessment
- **Passes** — rules the project satisfies
- **Violations** — rules that are broken, with file/line citations from the subagent
- **Suggestions** — actionable fix for each violation

Do **not** update the review record with audit results — the review skill is read-only. The record stays `open` with unchecked boxes. Only adopt and upgrade mark items and lock records.

## Guidelines

- This is a **read-only audit** by default. Don't modify files unless the user asks you to fix violations.
- The server runtime is pluggable (Hono or Express). Accept either as valid.
- Package names are flexible. Do not flag packages for having non-standard names — audit their internal structure and dependencies instead. A project may have multiple server and client packages.
- If a `tseng/project-structure.md` exists, check whether it is outdated and offer to update it.
- Do not flag the absence of `tseng/` — it is a generated folder.
- If the project doesn't use the expected stack at all, say so and suggest whether bootstrapping from scratch would be more appropriate.
- Review records are **immutable once written**. Never modify a previously written review file. Always append a new record.
