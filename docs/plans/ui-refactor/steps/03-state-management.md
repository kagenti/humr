# Step 03 — State management

**Goal:** Zustand holds UI state only, never server state. Every slice exports selector hooks; components stop calling `useStore(s => ...)` inline.

**Skill reference:** [`references/state-management.md`](../../../../.agents/skills/react-ui-engineering/references/state-management.md).

**Preconditions:** step 02 (data layer) complete for this domain — you can't remove server-state mirrors from Zustand until TQ is the source of truth.

---

## Scope

1. Zustand slices that cache server lists (e.g., `store/agents.ts`'s `agents: Agent[]`, `store/secrets.ts`'s `secrets: SecretView[]`).
2. Slice-level `fetchX()` actions that call the network.
3. Components duplicating server state into local `useState` even when a store slice holds it.
4. Inline `useStore((s) => s.x)` consumption across the domain's components.

## Recipe

### Remove server state from Zustand

If a slice has a field like `agents: Agent[]` and an action `fetchAgents()`:

1. Confirm `useAgents()` (or equivalent) now reads from TanStack Query (step 02).
2. Delete the field, its setter, and `fetchAgents()`.
3. Remove manual invalidation — store actions that did `await fetchAgents()` after mutations.
4. Keep only genuine UI state on the slice: `selectedAgentId`, `filter`, `sortOrder`, etc.

### Remove local server-state mirrors

Anti-pattern (after step 02, this is still valuable to clean up):

```tsx
const [secrets, setSecrets] = useState<SecretView[]>([]);
useEffect(() => { setSecrets(storeSecrets); }, [storeSecrets]);
```

Fix: read directly from the TQ hook. Delete the local mirror.

### Selector hooks per slice

Every slice file exports named selector hooks. Components import those, not `useStore`.

```ts
// modules/{domain}/store.ts (or src/store/{domain}.ts)
export interface DomainUiSlice {
  selectedId: string | null;
  filter: string;
  setSelectedId: (id: string | null) => void;
  setFilter: (q: string) => void;
}

export const createDomainUiSlice: StateCreator<AppStore, [], [], DomainUiSlice> = (set) => ({
  selectedId: null,
  filter: "",
  setSelectedId: (id) => set({ selectedId: id }),
  setFilter: (q) => set({ filter: q }),
});

export const useSelectedDomainId = () => useStore((s) => s.selectedId);
export const useDomainFilter = () => useStore((s) => s.filter);
export const useDomainUiActions = () =>
  useStore((s) => ({ setSelectedId: s.setSelectedId, setFilter: s.setFilter }), shallow);
```

Split state from actions. Actions rarely change identity; isolating them prevents needless re-renders.

### Context for tightly-scoped state

If the state is only consumed by one feature tree (e.g., onboarding wizard steps, a multi-step dialog), prefer a `createContext` + provider over a global slice. Keep Zustand for app-global UI state.

## Definition of done

- No field on any Zustand slice holds data whose source of truth is the server.
- No slice has a `fetchX()` action; data fetching is entirely in TQ hooks.
- No component in the domain calls `useStore((s) => ...)` inline — all access is through named selector hooks.
- Selectors split state (data) from actions.
- `mise run check` green.

## How to verify

1. **`mise run check`** — must pass.
2. **Grep checks:**
   - `grep -r "useStore((s)" src/modules/{domain}/` → empty.
   - `grep -rn "fetchAgents\|fetchSecrets\|fetchConnections" src/modules/{domain}/` (substitute domain keywords) → empty.
3. **React DevTools profiler** — exercise the domain; selector-based reads should not trigger re-renders on unrelated state changes.
4. **Playwright or user test** — domain's primary flow still works. Extra: after a mutation in one tab, another open tab in the same session shows the updated state once invalidation fires (sanity that TQ is now truly the source of truth).
