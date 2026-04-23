# Domain — files

File tree / file viewer for the agent workspace.

## Files in scope

- `src/panels/files-panel.tsx` — tree + viewer.
- `src/hooks/use-file-tree.ts` — tree state.
- `src/components/markdown.tsx` — viewer for `.md` files (may be a primitive — decide in step 01).
- `src/components/highlighted-code.tsx` — syntax highlighting (likely primitive).
- `src/store/files.ts` — zustand slice.

Target module: `src/modules/files/`.

`markdown.tsx` and `highlighted-code.tsx` are most likely primitives — used by chat too. Classify in step 01 before moving.

## Known specifics

- File-tree expand/collapse state is UI-local; selector hooks in step 03.
- YAML frontmatter split for markdown viewer lives in `markdown.tsx` (PR #261). Preserve that behavior.
- Large files: viewer pagination / virtualization is out of scope for this refactor; flag if it comes up.

## Step checklist

| Step | Focus | PR |
|---|---|---|
| 01 structure | classify markdown/highlighted-code as primitives; move files-panel + use-file-tree | |
| 02 data | TQ for file-tree fetch + file-content fetch; invalidate on file write | |
| 03 state | selector hooks for expanded paths, selected file | |
| 04 splitting | split viewer vs tree if either grows | |
| 05 forms | likely no-op (no forms in this domain) | |
| 06 styling | file-row hover / selected states | |
| 07 clean | type the file-node shape; dedupe path helpers | |

## Smoke flow (verification)

1. Open files panel → tree renders at root.
2. Expand a folder → children load.
3. Click a file → viewer renders.
4. Markdown file → frontmatter split correctly (preserve PR #261 behavior).
5. Code file → syntax highlighted.
6. After an agent writes a file, tree + viewer update without manual refresh.

**Automation:** Playwright for tree expand + file selection + content render.
**Fallback:** user test for long-file rendering performance.
