# Components

**Read when:** writing a new component, a file approaches ~200 lines, extracting subcomponents, typing props, reviewing existing component code.

## Size and responsibility

**[CRITICAL] A component does one thing.** When a component starts juggling fetching, orchestrating sub-forms, rendering multiple distinct regions, and handling cross-cutting state — it's already too big. Size is a proxy for responsibility.

**[HIGH] ~300 lines is a warning flag, not a hard cap.** When you pass 300, stop and ask: is there an extraction I've been avoiding? Usually the answer is yes — a tab becomes a component, a complex list row becomes a component, a form section becomes a component. Don't mechanically split at 300; split along responsibility seams and let the number follow.

Good size discipline in practice:
- Page-level composition: 50–150 lines (wiring layout + feature components)
- Feature component: 100–250 lines (one coherent responsibility)
- Leaf / presentational: 20–80 lines

## Subcomponent extraction

**[CRITICAL] Extract when any of the following is true:**

1. **A mapped JSX block exceeds ~40 lines** of nested markup:
   ```tsx
   ❌ {connections.map((c) => (
        <div key={c.id} className="flex ...">
          {/* 30+ lines of nested JSX, handlers, conditional UI */}
        </div>
      ))}

   ✅ {connections.map((c) => (
        <ConnectionRow key={c.id} connection={c} onDisconnect={...} />
      ))}
   ```

2. **The same markup repeats with small variations.** Three similar rows → one `<Row variant=...>` component.

3. **A block has its own local state or effects.** If a fragment needs `useState`/`useEffect` to work, it should be its own component so the state is colocated.

4. **A tab, section, or panel has enough internal structure to warrant a name.** Naming the extraction is the test: if you can't give it a clean name, maybe it's not a real boundary.

### File layout for extracted subcomponents

Follow `references/project-structure.md` subcomponent layout rule. In short:
- Same-folder sibling file when the parent has < 10 sub-pieces.
- Nested folder when 10+ or when the group has its own hooks/types.

Example target layout for a multi-tab dialog split into pieces:
```
modules/{domain}/components/edit-xxx-dialog/
├── index.tsx              # container ~100-150 lines
├── credentials-tab.tsx
├── settings-tab.tsx
├── header-row.tsx
├── item-group.tsx
├── item-row.tsx
├── mode-card.tsx
└── tab-button.tsx
```

## Props typing

**[HIGH] Declare props as an interface (or type) and destructure in the signature. No `React.FC<>`.**

```tsx
✅ interface Props {
     agent: Agent;
     onSelect?: (id: string) => void;
   }
   export function AgentCard({ agent, onSelect }: Props) { ... }

❌ const AgentCard: React.FC<Props> = ({ agent, onSelect }) => { ... }
```

Why not `FC<>`? It was introduced to solve problems React itself no longer has (implicit `children`, generic inference quirks). It adds clutter without benefit today, and modern React guidance is to skip it.

**Naming:** use `Props` inside a component file — it's always clear from context. Export it only when a parent needs to reference the type.

### Optional vs required

**[HIGH]** If a prop has a meaningful default, declare it optional in the type and default it in destructuring:
```tsx
interface Props {
  variant?: "primary" | "ghost";
}
export function Button({ variant = "primary" }: Props) { ... }
```

Avoid optional props that mean "configure how I work." If a component behaves differently in multiple modes, split it (`<AgentCard>`, `<AgentCardCompact>`) or accept an explicit `mode` prop and `match` on it.

### Children

When a component passes through children, type them explicitly rather than extending `PropsWithChildren`:
```tsx
✅ interface Props {
     children: ReactNode;
     title: string;
   }
```

## Handlers

**[HIGH]** Name handlers `onX` (prop) / `handleX` (internal). Keep inline handlers tiny — if the body is more than one statement, extract to a named function above the return.

```tsx
✅ function handleToggle(id: string) {
     setAssigned((prev) => toggleInSet(prev, id));
   }
   return <Checkbox onChange={() => handleToggle(item.id)} />;

❌ return <Checkbox onChange={() => {
       const next = new Set(assigned);
       if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
       setAssigned(next);
     }} />
```

The second form is also a DRY candidate: a toggle-in-Set pattern shows up whenever the user picks a subset from a list. Extract to a `useToggleSet()` hook (see `references/hooks.md`).

## Conditional rendering

**[MODERATE]** Keep conditionals shallow. Nested ternaries are hard to read:
```tsx
❌ {loading ? <Spinner /> : error ? <Error /> : data ? <List items={data} /> : null}

✅ if (loading) return <Spinner />;
   if (error) return <Error error={error} />;
   if (!data) return null;
   return <List items={data} />;
```

Early returns read top-to-bottom and make it obvious what conditions lead to what UI.

## Derived state

**[CRITICAL] Never duplicate derivable state into `useState`.** Compute it on render — memoize with `useMemo` only if measurably expensive:

```tsx
❌ const [filteredAgents, setFilteredAgents] = useState([]);
   useEffect(() => {
     setFilteredAgents(agents.filter(a => a.name.includes(filter)));
   }, [agents, filter]);

✅ const filteredAgents = useMemo(
     () => agents.filter((a) => a.name.includes(filter)),
     [agents, filter]
   );
```

Duplicating into `useState` + `useEffect` creates a second source of truth for derived values — the classic cause of "why is this stale" bugs.

## Side effects

**[HIGH]** `useEffect` is for synchronizing with external systems (subscriptions, DOM, network when TQ isn't a fit). It is **not** for:
- Computing derived state (use a memo or just compute inline).
- Responding to a user event (put the logic in the handler).
- Fetching data (use TanStack Query — see `references/async-data.md`).

If your component has more than ~2 `useEffect` calls, it's orchestrating too much — extract a hook.

## Styling in components

See `references/styling.md`. Summary:
- Tailwind utility classes for static styles.
- `cn()`/`clsx` for conditionals.
- **No `style={{}}` for static values** — that's a class.
- CSS custom properties for dynamic numeric/color values.

## Anti-patterns to fix on sight

Flag and fix when you touch the file:

1. **Subcomponents inlined in the same file** as the parent. Split to sibling files or a nested folder (see project-structure.md).
2. **Local `useState` duplicating server state.** Move to a TanStack Query hook (`references/async-data.md`).
3. **Inline 30-line `.map(...)` blocks** that should be components.
4. **Static inline `style={{}}`** for shadows, spacing, or any non-runtime value. Move to Tailwind classes (`references/styling.md`).
5. **Deeply nested ternaries** for loading/error/data — refactor to early returns.
