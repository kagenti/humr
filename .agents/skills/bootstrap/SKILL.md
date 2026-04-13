---
name: bootstrap
description: >
  Bootstrap a new greenfield TypeScript client-server project with an opinionated
  monorepo architecture. Use when the user asks to bootstrap, scaffold, or initialize
  a new project. Triggers on phrases like "bootstrap my project", "scaffold a new project",
  "start a new typescript project", "set up my project", or "create a new app".
  Also invocable via the /tseng:bootstrap slash command.
---

```!
echo "Architecture docs: ${CLAUDE_SKILL_DIR}/architecture/"
echo "Version: $(cat "${CLAUDE_SKILL_DIR}/VERSION")"
```

# TSEng Bootstrap

Scaffolds a new greenfield TypeScript client-server monorepo.

## How It Works

1. **Greenfield check** — List the target directory contents. If it contains existing source code, `package.json`, or a `packages/` directory, **stop immediately** and tell the user this skill is for greenfield projects only. Suggest using the `review` skill instead to audit their existing project. Only allow proceeding if the directory is empty or contains only dotfiles (`.git`, `.gitignore`, etc.), `README.md`, or `LICENSE`.
2. **Get version** — The current tseng version is shown above (injected from the VERSION file). Embed this version in the review record.
3. Read `architecture/index.md` from the architecture docs directory (shown above) — it describes the overall architecture and points to deeper dives on each topic.
4. Read the specific architecture files (in the same architecture docs directory) you need for the current step of bootstrapping. You will likely need all of them, but load them as you go rather than all at once.
5. Ask the user for a project name (or infer from the directory name), server runtime (Hono or Express, default: Hono), and package manager preference (default: pnpm).
6. Scaffold the full monorepo with working sample code in every layer, conforming to the architecture.
7. Write `tseng/project-structure.md` with the project metadata format described in the architecture docs.
8. Generate a review checklist from the architecture docs (same process as review/adopt: read all linked files, extract every concrete verifiable rule). Write it to `tseng/reviews/001.md` as the first review record, with all items marked `[x]` (the scaffold conforms by construction) and **immediately locked**:

   ```markdown
   # Review #001

   <!-- tseng_version: {version} -->
   <!-- status: locked -->
   <!-- created: {YYYY-MM-DD} -->
   <!-- locked: {YYYY-MM-DD} -->

   Generated from architecture docs (tseng v{version}).
   Bootstrap — all items pass by construction.

   ## Stack
   - [x] Uses tRPC for API layer
   - [x] Uses Zod for input validation
   - ...
   ```

9. Create `tseng/reviews/index.md`:

   ```markdown
   # Review History

   | # | Date | TSEng Version | Status |
   |---|------|---------------|--------|
   | [001](001.md) | {YYYY-MM-DD} | {version} | locked |
   ```

10. Write `tseng/index.md` using the template from the architecture docs. Include sections for "Project Metadata" and "Review History" since both now exist.
11. Add a `## TSEng` section to the project's root `CLAUDE.md` pointing to `tseng/index.md`. If `CLAUDE.md` doesn't exist, create it.
12. Tell the user what was created and suggest next steps.

## Guidelines

- Greenfield projects only — the directory should be empty or near-empty.
- Include working sample code in each layer, not just empty directories.
- The architecture docs are the source of truth — don't deviate from them.
- The first review record (`001.md`) is created locked — it is an immutable record of the project's initial state.
