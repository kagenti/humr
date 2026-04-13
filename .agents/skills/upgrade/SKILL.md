---
name: upgrade
description: >
  Upgrade a previously bootstrapped or adopted project when the architecture evolves.
  Diffs the current architecture rules against the project's last locked review,
  identifies new or changed rules, and proposes incremental changes.
  Triggers on phrases like "upgrade my project", "sync with latest architecture",
  "update to new rules", "upgrade tseng", or "architecture changed, update my project".
  Also invocable via the /tseng:upgrade slash command.
---

```!
echo "Architecture docs: ${CLAUDE_SKILL_DIR}/architecture/"
echo "Version: $(cat "${CLAUDE_SKILL_DIR}/VERSION")"
```

# TSEng Upgrade

Upgrades an existing project that previously ran bootstrap or adopt to reflect evolved architecture rules. Reads the **last locked review record**, diffs it against the current architecture docs, and creates a **new review record** for the delta.

## Prerequisites

The target project must have at least one **locked** review in `tseng/reviews/`. Read `tseng/reviews/index.md` to find the latest locked review. If no locked reviews exist, tell the user to run `/tseng:adopt` first — there's nothing to upgrade from.

## Phase 1 — Get Version

The current tseng version is shown above (injected from the VERSION file).

## Phase 2 — Regenerate Checklist

Generate a fresh checklist from the current architecture docs:

1. Read `architecture/index.md` from the architecture docs directory (shown above).
2. Read every file linked from the index (in the same architecture docs directory).
3. Extract every concrete, verifiable rule into a checklist (same rules as review/adopt — no `tseng/` files, no inferred rules).

Do NOT write this checklist to disk yet.

## Phase 3 — Diff Against Last Locked Review

Read the project's **last locked review** from `tseng/reviews/` (the highest-numbered record with `status: locked`).

Compare the freshly generated checklist against the locked review's items:
- **New rules** — items in the fresh checklist that have no corresponding item in the locked review.
- **Changed rules** — items where the wording or criteria meaningfully changed (not just cosmetic reformatting).
- **Removed rules** — items in the locked review that no longer appear in the architecture docs. Flag these for the user but take no action.

Compare the tseng version from the locked review (`tseng_version` metadata) against the current version. If they match and there are no new/changed rules, tell the user the project is already up to date and stop.

## Phase 4 — Load Adoption State

Read `tseng/adoption.md` if it exists. Each discarded entry includes a user-provided reason (e.g., "will adopt after auth migration", "not relevant for this project"). Use these reasons to make informed decisions:

- **Unchanged rules** with a discard reason must not be re-proposed — the user's reasoning still applies.
- **Changed rules** ARE eligible for re-proposal even if previously discarded — the rule evolved, so the original reason may no longer apply. When presenting these to the user, show both the old discard reason and what changed so they can make an informed decision.

## Phase 5 — Create New Review Record

Determine the next review number from `tseng/reviews/index.md`.

Write the new review to `tseng/reviews/NNN.md`. The checklist should contain:
- All items from the fresh checklist (the full current architecture)
- Items that were `[x]` in the last locked review and are unchanged remain `[x]` (carried forward)
- New and changed items start as `[ ]`

```markdown
# Review #NNN

<!-- tseng_version: {version} -->
<!-- status: open -->
<!-- created: {YYYY-MM-DD} -->
<!-- based_on: #PPP -->

Generated from architecture docs (tseng v{version}).
Upgrade from review [#PPP](PPP.md) (tseng v{previous_version}).

## New Rules
- [ ] {new rule 1}
- [ ] {new rule 2}

## Changed Rules
- [ ] {changed rule 1} (was: "{old wording}")

## Unchanged (carried forward from #PPP)
- [x] Uses tRPC for API layer
- [x] Uses Zod for input validation
- [ ] Some previously failing rule
- ...

## Removed Rules (informational)
- ~~{removed rule}~~ — no longer in architecture docs
```

Update `tseng/reviews/index.md` with the new row (status: `open`).

## Phase 6 — Audit New & Changed Rules

Launch a subagent to audit **only the new and changed items** against the project:

```
You are auditing a TypeScript project at {project_path} against a checklist of architecture rules.

Go through EVERY item below. For each one:
- Check the project files to determine if the rule is satisfied
- Mark it ✅ (pass) or ❌ (fail) or ⚠️ (partially met / not applicable)
- Cite the specific file and line that proves your assessment
- If it fails, briefly say what's wrong

Do NOT check anything beyond this list. Do NOT add suggestions, improvements, or opinions. Only verify what's listed.

CHECKLIST:
{new_and_changed_items}
```

## Phase 7 — Propose Changes

From the audit results, collect all ❌ and ⚠️ items that are NOT in the discarded list (respecting the changed-rule exception from Phase 4). Group them into concrete change proposals:

Present proposals to the user as a numbered list. Each proposal should include:
- Whether this is a **new rule** or a **changed rule**
- The rule being violated
- What needs to change (specific files/directories)
- Rough scope of the change (one-liner)

Ask the user which proposals to **accept** and which to **discard**. The user can respond with numbers, ranges, "all", or "none".

For any discarded proposals, ask the user for a **brief reason** (e.g., "will cover this later", "using a different pattern intentionally", "not relevant for this project"). This context is recorded in `adoption.md` so future upgrade runs can understand *why* something was rejected.

## Phase 8 — Apply Accepted Changes

For each accepted proposal, make the actual code changes. Follow the architecture docs as the source of truth.

## Phase 9 — Lock the Review Record

Update `tseng/reviews/NNN.md`:

1. Mark each checklist item based on the final state:
   - `[x]` — rule satisfied (passed audit, carried forward, or just applied)
   - `[ ]` — rule not satisfied (user discarded or remains unaddressed)
2. Update the metadata:
   ```
   <!-- status: locked -->
   <!-- locked: {YYYY-MM-DD} -->
   ```
3. Update the corresponding row in `tseng/reviews/index.md` to show `locked` status.

**Once locked, the review is a permanent, immutable record.**

## Phase 10 — Update State

Update `tseng/adoption.md` — merge new applied/discarded items with existing content. Don't lose previously recorded items. Include the review number for traceability:

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

If any rules were **removed** from the architecture, move their entries from Applied/Remaining to a `## Retired` section — they no longer apply but the historical record is preserved.

## Guidelines

- Only for projects that have at least one locked review. If `tseng/reviews/index.md` doesn't exist or has no locked reviews, redirect to `/tseng:adopt`.
- Changed rules override prior discards — if a rule evolved, the user should reconsider it.
- Removed rules are informational — flag them but don't revert applied changes.
- Apply changes incrementally, same as adopt.
- The architecture docs are the source of truth.
- The server runtime is pluggable (Hono or Express). Accept either as valid.
- Upgrade is iterative — the user can run `/tseng:upgrade` multiple times. Each run reads the last locked review and creates a new one.
- Review records are **immutable once locked**. Never modify a previously locked review file.
