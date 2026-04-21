# State management

**Read when:** deciding where a new piece of state lives, writing a Zustand slice, adding a React Context, reviewing a component's state, considering moving state between layers.

## The lineage model (CRITICAL — do not skip)

State is classified by where its source of truth lives. Each lineage has a designated home. Mixing lineages is the main cause of stale-state bugs, redundant fetching, and state sprawl.

| Lineage | Source of truth | Home | Examples |
|---|---|---|---|
| **Server** | Backend | TanStack Query cache | lists of agents, secrets, connections; user profile; connector config |
| **UI, global** | Client | Zustand or React Context | theme, open dialog, selected agent id, navigation collapsed, toast queue |
| **UI, local** | Client | `useState` / `useRef` | input focus, hover, form field value before submit, accordion expanded |
| **URL** | URL | `useSearchParams` / path | route, filters, selected tab, pagination, search query |

**[CRITICAL] Do not duplicate state across lineages.** If the server owns it, don't copy it into Zustand. If Zustand owns it, don't shadow-copy into `useState`. If the URL owns it, don't mirror it into Zustand without a strong reason (e.g., a brief optimistic UI beat before the route resolves).

### Decision recipe

1. "Does this value come from the server, or will it be persisted there?" → **TanStack Query.** Stop.
2. "Is this needed by more than one component that isn't parent/child?" → **Zustand or React Context.** Pick one per project and stick with it.
3. "Could a refresh / share link ruin the experience if we lost this?" → **URL.**
4. Otherwise → **`useState`** in the component.

## Server state — TanStack Query

See `references/async-data.md` for the full TQ conventions. Key rules for state management:
- Never store a server-derived list in Zustand.
- Mutations invalidate queries via `meta.invalidates`.
- Optimistic updates use TQ's `onMutate`, not a Zustand shadow copy.

## Zustand

**[HIGH]** Zustand is a good choice for app-wide client state when the tree is deep, when fine-grained selector performance matters, or when you want state that lives outside any React subtree. React Context is the simpler default for fresh projects; prefer it unless you have a concrete reason for Zustand.

When migrating a legacy codebase that uses Zustand for server data, the slice holding a server list becomes a TanStack Query hook. The slice shrinks to whatever UI state is left (selected id, filters, etc.), often to nothing — in which case delete it.

### Slice pattern

One slice per domain, using `StateCreator`:

```ts
// src/store/agents.ts
export interface AgentsUiSlice {
  selectedAgentId: string | null;
  filter: string;
  setSelectedAgentId: (id: string | null) => void;
  setFilter: (q: string) => void;
}

export const createAgentsUiSlice: StateCreator<HumrStore, [], [], AgentsUiSlice> = (set) => ({
  selectedAgentId: null,
  filter: "",
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  setFilter: (q) => set({ filter: q }),
});
```

Note: this slice only holds UI state. The list of agents is no longer here — it's a TQ query.

### Selector hooks

**[CRITICAL] Every slice exports selector hooks.** Components never call `useStore(s => ...)` inline.

```ts
// src/store/agents.ts
export const useSelectedAgentId = () => useStore((s) => s.selectedAgentId);
export const useAgentFilter = () => useStore((s) => s.filter);
export const useAgentsUiActions = () =>
  useStore(
    useShallow((s) => ({
      setSelectedAgentId: s.setSelectedAgentId,
      setFilter: s.setFilter,
    })),
  );
```

Why:
- Component import sites stay clean: `const selectedId = useSelectedAgentId()`.
- Refactoring the slice shape doesn't touch every component.
- State/actions split: `useShallow` on the actions hook gives stable identity; components that only dispatch don't re-render on value changes.

### State/actions split

**[HIGH]** Keep the state selector and the actions selector separate. Actions almost never change reference when wrapped with `useShallow`; splitting them means a component that just calls `setFilter` doesn't re-render when `selectedAgentId` changes.

```ts
// ✅ Good
const selectedId = useSelectedAgentId();        // re-renders when id changes
const { setSelectedAgentId } = useAgentsUiActions(); // stable, no re-render
```

### Shallow equality for multi-field selects

**[HIGH]** Whenever you select multiple fields from the store, use `useShallow`:

```ts
import { useShallow } from "zustand/react/shallow";

export const useToast = () =>
  useStore(
    useShallow((s) => ({ message: s.toast.message, kind: s.toast.kind })),
  );
```

Without `useShallow`, the default equality check is reference equality on the returned object — which Zustand rebuilds every render, causing wasteful re-renders.

### Never store server state

**[CRITICAL] Do not put TQ-cacheable data in Zustand.** If a piece of state has a fetch behind it, it belongs in TQ. A legacy slice typically decomposes like this:

- **UI bits** (selected id, filter, list-vs-card view) → stay in Zustand.
- **Server list + fetch** → a TQ query hook (e.g., `useAgents()`).
- **Mutations** (create, delete, update) → a TQ mutation hook (`useCreateAgent()`).
- **Hand-rolled `runQuery` / `runAction` / retry wrappers** → delete, TQ handles the semantics.

The store shrinks to a store of UI-only slices.

### Devtools

**[MODERATE]** Wrap the store in the `devtools` middleware in development. Name actions with `set(partial, false, "agents/setFilter")` for a readable devtools timeline.

## React Context (preferred in fresh projects)

Context is the default for cross-cutting UI state when you're not already committed to Zustand.

### Provider + hook pattern

```ts
// contexts/theme/theme-context.ts
interface ThemeContextValue { theme: Theme; setTheme: (t: Theme) => void; }
export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// contexts/theme/theme-provider.tsx
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// contexts/theme/index.ts
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

**[HIGH] Throw from the hook when the provider is missing.** It's a programmer error — crash early. Silent `undefined` returns hide bugs.

**[HIGH] Memoize the context value** with `useMemo` when it's an object. Otherwise every render broadcasts a new reference and every consumer re-renders.

**[MODERATE] Split state from setters** into two contexts when consumer components overwhelmingly read OR write, not both:

```tsx
<ThemeStateContext.Provider value={theme}>
  <ThemeActionsContext.Provider value={actions}>{children}</ThemeActionsContext.Provider>
</ThemeStateContext.Provider>
```

This is the Context equivalent of the Zustand state/actions split.

## Local `useState`

For truly component-local state. If you find yourself reaching for `useState` and the value is:
- Derivable from props or other state → **don't** (compute or `useMemo`).
- Coming from a fetch → **don't** (TQ).
- Needed by a sibling → **don't** (lift to common parent, Zustand, or Context).
- Shareable via URL → **don't** (URL).

If none apply, `useState` is correct.

### Keep it small

If a component accumulates ~5 `useState` calls, step back: they're probably related. Group them into a reducer or a hook:

```tsx
❌ const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [data, setData] = useState<Agent[]>([]);
   // (this is a TQ query, though — see references/async-data.md)

✅ const { data, isLoading, error } = useAgents();
```

Or, for genuinely local composite state, `useReducer`:
```ts
const [state, dispatch] = useReducer(wizardReducer, initialWizard);
```

## URL state

**[HIGH]** For values that should survive a refresh or be shareable via link:
- Current route / subview
- Active tab in a persistent panel
- Filters, sort order, pagination
- Search query
- Selected entity id (when it determines the page's content)

Use `useSearchParams` or the router's equivalent. Don't store in Zustand and sync manually — the URL is the source of truth.

Common candidates worth promoting to URL: the currently selected entity id on a detail page, list filters and sort order, active tab in a persistent panel, search query.

## Summary of rules

- [CRITICAL] Classify state by lineage before you write it. No duplication.
- [CRITICAL] Server state → TanStack Query. Never in Zustand.
- [CRITICAL] Context hooks throw on missing provider.
- [HIGH] Zustand: slice per domain, selector hooks, `useShallow` for multi-field, state/actions split.
- [HIGH] Context value memoized; split state/actions when appropriate.
- [HIGH] URL owns shareable state.
- [MODERATE] `useReducer` for related local state; `zustand/devtools` in dev.
