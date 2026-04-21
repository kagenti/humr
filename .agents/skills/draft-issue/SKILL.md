---
name: draft-issue
description: >
  Draft a GitHub issue that defines a problem and proposes a high-level solution from the user's perspective, with no implementation details. Present the draft for approval, then file it via the `gh` CLI.
  TRIGGER when: user wants to draft, file, or "drop" a GitHub issue / ticket.
argument-hint: "[what the issue is about]"
---

# Draft an Issue

Produce a GitHub issue that reads like a product ticket, not an engineering plan. The reader should understand **what problem exists** and **what the user-visible outcome of fixing it looks like** — nothing more.

## Workflow

1. **Understand the request thoroughly.** Read the user's prompt carefully — multiple times if it's long or ambiguous. Identify what problem they're describing, who it affects, and what outcome they want. Restate it back in one or two sentences to confirm shared understanding. Ask follow-ups for anything that would change the shape of the issue (scope, who it affects, dependencies on other work). Do not start drafting until you genuinely understand the ask.

2. **Research the codebase thoroughly.** Do real investigation of the current state — read relevant files, trace how the feature works today, understand the user-visible behavior end-to-end. The goal is to describe the status quo *accurately*, not superficially. A shallow understanding produces a vague ticket.

   **But keep the research out of the issue itself.** Do not pull file paths, function names, line numbers, data structures, or architectural detail into the draft. The research informs your writing; it does not appear in it. If a sentence only makes sense to someone who's read the code, rewrite it.

3. **Check for duplicates.** Before drafting (or at latest, before filing), search existing issues on the target repo:

   ```sh
   gh issue list --repo owner/repo --search "keywords" --state all
   ```

   Use multiple keyword variations drawn from the user's request. If you find a plausible duplicate or closely-related issue, surface it to the user with a one-line summary and ask how to proceed — options include: add a comment to the existing issue, file a new one anyway with a cross-link, or close the request as already-tracked. Do not silently file a duplicate.

4. **Draft inline.** Present the full draft (title + body) in the chat, in the format below. Do not file yet.

5. **Get explicit approval.** Ask whether to file as-is or revise. NEVER file without explicit approval.

   **Every revision invalidates the previous approval.** If the user requests any change after approving — even a small one — you must present the revised draft and get a fresh, explicit "file it" before sending to GitHub. Do not assume the original approval carries over.

6. **File via `gh` CLI.** Use `gh issue create`. Infer the repo from context (current working directory's git remote, or a repo mentioned earlier in the session). If unclear, ask. Return the issue URL.

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

## Filing

After approval, file with `gh issue create`. Do not use the GitHub MCP tools (`mcp__github__*`) for this — always use `gh`.

- `--repo owner/repo` — infer from git remote or prior context; ask if ambiguous
- `--title "..."` — exactly as approved
- `--body "..."` — exactly as approved; pass via a HEREDOC so markdown formatting survives
- `--label foo --label bar` — only if the user specified labels

Example:

```sh
gh issue create --repo owner/repo --title "Short declarative title" --body "$(cat <<'EOF'
## Problem

...

## Proposed solution

...
EOF
)"
```

Return the resulting issue URL to the user in one line. Do not add commentary about what was filed — the draft already conveyed that.
