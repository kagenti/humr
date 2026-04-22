# Step 06 — Styling

**Goal:** remove every static `style={{}}` from the domain. Tailwind for classes, CSS variables for theme, `cn()` for conditional composition. Runtime values (progress width, dynamic color) are the only valid `style={{}}` use.

**Skill reference:** [`references/styling.md`](../../../../.agents/skills/react-ui-engineering/references/styling.md).

**Preconditions:** step 04 (splitting) complete — smaller files make the style audit tractable.

---

## Scope

1. Every `style={{...}}` in the domain that doesn't reference a runtime value.
2. Class strings built by ad-hoc template literals (`className={`... ${x ? "a" : "b"}`}`) — switch to `cn()`.
3. Hard-coded colors or shadows that should be theme tokens.

## Recipe

### Static style → Tailwind / CSS variable

Anti-pattern (76 instances across the codebase at the start of this refactor):

```tsx
<div style={{ boxShadow: "var(--shadow-brutal-sm)" }}>
```

Two valid fixes, pick per case:

- **Expose a utility in Tailwind config.** Best when the value is reused across the codebase.
  ```ts
  // tailwind.config.ts
  boxShadow: { 'brutal-sm': 'var(--shadow-brutal-sm)' }
  ```
  Usage: `<div className="shadow-brutal-sm">`.
- **Extract a component / variant.** Best when a cluster of styles always travels together.
  ```tsx
  <Card variant="brutal">...</Card>
  ```

### Conditional classes → `cn()`

```tsx
className={cn(
  "rounded px-3 py-1",
  isActive && "bg-primary text-white",
  isDisabled && "opacity-50 pointer-events-none",
)}
```

No string concatenation. No template-literal mazes.

### Runtime values keep `style={{}}`

Legitimate cases where Tailwind cannot express the value at build time:

```tsx
<div style={{ width: `${percent}%` }} />
<div style={{ "--accent": color } as React.CSSProperties} />
```

Prefer CSS custom properties for dynamic theme-like values — Tailwind utilities can then bind to them.

### Theme tokens

If you find a hard-coded color (`#2b7fff`), trace it to the design system. It should be a CSS variable (`var(--accent)`) or a Tailwind token (`text-accent`). Never a raw hex.

### Dark mode

Class-based (`.dark` on `<html>`). Style dark variants with `dark:` prefix; no JavaScript branching.

## Definition of done

- `grep -rn "style={{" src/modules/{domain}/` returns only lines that use a runtime value (confirmable at a glance).
- No template-literal class strings with conditionals; `cn()` everywhere.
- No hard-coded colors or shadows that should be tokens.
- `mise run check` green.

## How to verify

1. **`mise run check`** — must pass.
2. **Grep audit:** `grep -rn "style={{" src/modules/{domain}/` — every remaining hit should be justified by a runtime value. Add a one-line comment if it's not obvious.
3. **Visual regression — user test:** the domain's primary screens in both light and dark mode. Hover states, disabled states, focus rings. Styling regressions are easy to miss in automated checks.
4. **Playwright (if available):** screenshot-compare on key screens in both themes.
