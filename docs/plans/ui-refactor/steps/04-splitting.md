# Step 04 — Splitting (components + hooks)

**Goal:** break god components and god hooks into pieces each with a single responsibility. No file in the domain exceeds ~300 lines without a written reason; no hook has >5 `useState`/`useRef` or >3 `useEffect`.

**Skill references:**
- [`references/components.md`](../../../../.agents/skills/react-ui-engineering/references/components.md)
- [`references/hooks.md`](../../../../.agents/skills/react-ui-engineering/references/hooks.md)

**Preconditions:** steps 02 (data) + 03 (state) complete for this domain. Splitting before those leaves the new pieces tangled in fetch-and-mirror bookkeeping.

---

## Scope

1. Any file > ~300 lines.
2. Any component with > ~5 `useState` calls, > 3 `useEffect` calls, or > 40 lines of inline-mapped JSX.
3. Any hook with > 5 `useState`/`useRef` or > 3 `useEffect`.
4. Subcomponents defined inside a parent file that also does real work.

## Recipe

### God component → container + parts

For a 600-line dialog with tabs, rows, and modes:

1. Create `modules/{domain}/components/{dialog-name}/`.
2. Move the top-level dialog to `{dialog-name}.tsx` as a thin container (~120 lines): layout, tab state, data wiring.
3. Each tab becomes its own file: `credentials-tab.tsx`, `env-tab.tsx`, etc. (~150 lines each.)
4. Row-level and card-level subcomponents become siblings: `app-row.tsx`, `mode-card.tsx`, `tab-button.tsx`. (~50 lines each.)
5. Inline `useMemo` derivations that are reused go into `hooks/use-{selector}.ts`.

### Inline-mapped JSX → subcomponent

40+ lines of JSX inside a `.map((item) => ...)` is always a subcomponent:

```tsx
{items.map((item) => (
  <AppConnectionRow key={item.id} connection={item} onDisconnect={...} />
))}
```

### God hook → orchestrator + focused children

For a 600-line `use-xxx-session.ts` managing websocket, list, cache, updates, finalization:

```
modules/{domain}/hooks/
├── use-xxx-connection.ts       # socket open/close/reconnect, `send`
├── use-xxx-list.ts             # list as TQ query (may already exist from step 02)
├── use-xxx-config-cache.ts     # cache + persistence
├── use-xxx-streaming-updates.ts# update routing / projection
└── use-xxx-session.ts          # thin orchestrator (~50 lines)
```

The orchestrator composes the children; each child is independently testable.

### Shared utility hooks

If extracting reveals a pattern already open-coded in ≥3 files, promote it:

```ts
// src/hooks/use-toggle-set.ts
export function useToggleSet<T>(initial: T[] = []) {
  const [set, setSet] = useState<Set<T>>(() => new Set(initial));
  const toggle = useCallback((v: T) => {
    setSet((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSet(new Set()), []);
  return { set, toggle, clear, has: (v: T) => set.has(v), size: set.size };
}
```

Candidates: `useToggleSet`, `useDebouncedValue`, `useOnClickOutside`, `useLocalStorage`.

### Reuse existing primitives

Before hand-rolling: grep for what already exists. E.g., `<Modal>` provides Escape-to-close and backdrop click — don't reimplement in an ad-hoc dialog.

## Definition of done

- No file in the domain exceeds ~300 lines (unless a comment at the top justifies the exception).
- No hook in the domain has >5 `useState`/`useRef` or >3 `useEffect`.
- Subcomponents live in their own files, not inside the parent.
- No duplicated ad-hoc implementations of features already provided by shared primitives (modal, toast, overlay).
- `mise run check` green.

## How to verify

1. **`mise run check`** — must pass.
2. **Line-count audit:** `find src/modules/{domain} -name '*.tsx' -o -name '*.ts' | xargs wc -l | sort -rn | head`. Top files should be under ~300.
3. **Hook audit:** in the split hooks, count `useState` / `useEffect` by eyeballing — no hook should be hard to follow.
4. **Playwright or user test** — exercise every surface the split touched:
   - Open the dialog (if a dialog was split) and test each tab.
   - Trigger the orchestrator flow (if a hook was split) end-to-end: e.g., chat session start → message send → receive → reconnect.
5. **Diff review** — the behavior diff should be ~zero. A split is refactoring, not rewriting.
