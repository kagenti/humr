---
name: arch-review
description: >
  Review code changes (PRs, diffs, branches) against the opinionated TypeScript architecture rules.
  Checks whether changes align with the architecture — layer dependencies, module boundaries, event patterns,
  domain purity, and structural conventions.
  Triggers on phrases like "review this PR", "arch review", "check if this change follows the architecture",
  "review these changes", "does this PR align with the architecture", or "architecture review".
  Also invocable via the /tseng:arch-review slash command.
---

```!
echo "Architecture docs: ${CLAUDE_SKILL_DIR}/architecture/"
echo "Version: $(cat "${CLAUDE_SKILL_DIR}/VERSION")"
```

# TSEng Arch Review

Reviews specific code changes (PRs, diffs, branches) against the architecture rules. Unlike the full-project `review` skill, this skill focuses on **what changed** and whether those changes comply with the architecture. No review records are created — this is a lightweight, focused review.

## Phase 1 — Load Architecture Overview (Progressive Disclosure)

Read only the overview to start — load specific docs lazily based on what the changes touch:

1. Read `architecture/index.md` from the architecture docs directory (shown above). This gives you the map of all topics without the full weight.

**Do NOT read all architecture files upfront.** Instead, load them on-demand in Phase 4 after you know which areas the changes affect:

| When the changes touch...                       | Then read...                  |
|-------------------------------------------------|-------------------------------|
| Technology/dependency choices                   | `stack.md`                    |
| Layer code (routers, services, domain)          | `slice-composition.md`        |
| Module creation or modification                 | `modules.md`                  |
| Cross-module imports or communication           | `module-boundaries.md`        |
| Infrastructure (repos, adapters, DI)            | `infrastructure.md`           |
| File/directory structure, package layout        | `project-structure.md`        |

## Phase 2 — Load Project State

Read the project's TSEng context to understand where it stands:

1. Check if `tseng/index.md` exists. If it does, read it and follow every link:
   - `tseng/project-structure.md` — package layout, names, paths, server runtime
   - `tseng/adoption.md` — applied, discarded, and remaining changes
   - `tseng/reviews/index.md` — review history
   - The **latest locked review** — to understand current compliance state
2. Read the project's existing module structure by scanning server package `src/modules/` directories and contract package `src/modules/` directories.
3. Check if `tseng/vocabulary.md` exists. If it does, read it — this is the project's ubiquitous language.

If the project has no `tseng/` directory at all, warn the user that project context is missing and suggest running `/tseng:adopt` first. Do not refuse to proceed — the user may have a good reason — but warn that the review will lack project-specific context (e.g., discarded rules won't be respected).

## Phase 3 — Obtain Changes

Ask the user how they want to provide the changes to review:

> What would you like me to review?
> 1. **PR** — give me the PR number or URL
> 2. **Branch** — compare current branch against base (e.g., main)
> 3. **Local changes** — staged/unstaged changes in the working tree
> 4. **Specific commit(s)** — give me the commit SHA(s)

For option 1: Use `gh pr diff <number>` to get the diff and `gh pr view <number> --json title,body` for context.

For option 2: Use `git diff main...HEAD` (or whatever base the user specifies).

For option 3: Use `git diff` for unstaged and `git diff --cached` for staged changes.

For option 4: Use `git show <sha>` for each commit.

**Read the full diff.** Then read the **complete contents** of every changed file (not just the diff hunks) — architecture violations often depend on the full file context (e.g., the import block at the top, the module structure around the change).

## Phase 4 — Map Changes to Architecture & Load Relevant Docs

Before launching the subagent, analyze the changes to determine which architecture topics are relevant:

1. Identify which **packages** are affected (server, client, contracts, shared)
2. Identify which **modules** are affected (which bounded contexts)
3. Identify which **layers** are touched (domain, application/services, validation/routers, infrastructure)
4. Identify if there are **cross-module interactions** (imports between modules, events)
5. Identify if **new files/directories** were created (structural concerns)

Based on this analysis, load the specific architecture docs from the table in Phase 1. Read their **full contents** — the subagent will need the actual rules, not just file names.

If the changes are broad (touching multiple layers, modules, and structural concerns), load all architecture docs. For narrow changes (e.g., a single domain entity), load only the relevant subset.

## Phase 5 — Architecture Review via Subagent

Launch a subagent (using the Agent tool) to perform the actual review. The subagent receives the architecture docs as the review standard and the changes as the subject.

Use this subagent prompt template:

```
You are reviewing code changes in a TypeScript project at {project_path} against architecture rules.

ARCHITECTURE RULES (this is the standard — review the changes against everything stated here):
{full_architecture_doc_contents}

ADOPTION STATE (these rules were discarded by the project — do NOT flag violations for them):
{discarded_rules_or_"None — all rules apply"}

UBIQUITOUS LANGUAGE (check that changes use these established domain terms consistently):
{vocabulary_contents_or_"No vocabulary established yet"}

CHANGES TO REVIEW (diff):
{diff}

FULL FILE CONTENTS (for context — imports, structure, surrounding code):
{changed_file_contents}

Go through every rule in the architecture docs above. For each rule that is relevant to the changes:
- Check if the changes comply
- Mark it ✅ (compliant) or ❌ (violation) or ⚠️ (potential concern)
- Cite the specific file and line
- If it violates, explain what's wrong and how to fix it

Only review rules that are relevant to the changes. Skip rules about areas the changes don't touch.
Do NOT add suggestions, improvements, or opinions beyond what the architecture docs state. Only verify against the documented rules.
```

**Do NOT include the skill instructions, phase descriptions, or any other meta-context in the subagent prompt.** The subagent gets only the architecture rules, the changes, and the review instructions.

## Phase 6 — Report

Take the subagent's output and present the final report to the user:

- **Summary** — one-line overall verdict (aligned / mostly aligned / significant violations)
- **Violations** — architecture rules broken, with file:line citations and what's wrong. Include actionable fix for each.
- **Warnings** — partial compliance or patterns that could drift toward violations
- **Good patterns** — what the change does well architecturally (keep this brief)

## Guidelines

- This is a **read-only review**. Do not modify any files unless the user explicitly asks you to fix violations.
- The architecture docs are the **sole source of truth** for the review. Do not add "best practices", opinions, or rules not stated in the docs.
- **Respect discarded rules.** If `tseng/adoption.md` shows certain rules were discarded, do not flag violations for those rules.
- The server runtime is pluggable (Hono or Express). Accept either as valid.
- Package names are flexible. Do not flag packages for having non-standard names — review their internal structure and dependencies.
- If the changes are trivial (e.g., README edits, config tweaks unrelated to architecture), say so and skip the subagent review.
- If the project doesn't use the expected stack at all, say so and suggest whether `/tseng:adopt` or `/tseng:bootstrap` would be more appropriate.
- Focus on **what changed**, not the entire project. This is not a full project audit — use `/tseng:review` for that.
