# Styling

**Read when:** adding or changing styles, deciding between Tailwind/inline styles/CSS vars, composing conditional classes, reviewing existing style code.

## The stack

**Use Tailwind exclusively**, with CSS custom properties for theme-aware values in a single root stylesheet (typically `index.css`).

## Rules

### Tailwind for static styles

**[HIGH]** Everything static goes in Tailwind utility classes. No per-component CSS Modules, no CSS-in-JS, no SCSS.

```tsx
✅ <div className="flex items-center gap-3 rounded-lg border-2 border-border-light bg-bg px-4 py-2.5" />

❌ <div style={{ display: "flex", alignItems: "center", gap: "12px" }} />
```

### No static `style={{}}`

**[CRITICAL] Static inline styles are forbidden.** They duplicate Tailwind's job, bypass theme tokens, and scatter style decisions across files. Fix on sight when editing.

Common offender:
```tsx
❌ <button style={{ boxShadow: "var(--shadow-brutal-sm)" }} className="btn">
     Save
   </button>
```

Fix:
```tsx
// index.css or a Tailwind plugin: add `shadow-brutal-sm` utility mapping to the CSS var.
✅ <button className="btn shadow-brutal-sm">Save</button>
```

Or, for the two or three "brutal" button variants that repeat across the app, a utility component:
```tsx
✅ <BrutalButton variant="danger">Save</BrutalButton>
```

### Dynamic CSS custom properties — OK

**[HIGH]** When a value genuinely varies at runtime (a width percentage, a user-supplied color, a computed offset), set a CSS custom property on `style` and consume it in CSS:

```tsx
✅ <div style={{ "--progress": `${percent}%` } as CSSProperties} className="progress-bar" />
```

```css
.progress-bar::before {
  width: var(--progress);
}
```

This is the narrow legitimate use of `style={{}}`. Never use `style` for static values that could be a class.

### Conditional classes: `cn()` / `clsx`

**[HIGH]** Use a `cn()` helper (wrap `clsx` + `tailwind-merge`) for conditional classes. Don't build class strings with template literals.

```ts
// src/lib/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Usage:
```tsx
✅ <div className={cn(
     "rounded-lg border-2 px-4 py-2",
     isActive && "border-accent bg-accent/10",
     disabled && "opacity-50 cursor-not-allowed",
     className
   )} />

❌ <div className={`rounded-lg border-2 px-4 py-2 ${isActive ? "border-accent bg-accent/10" : ""} ${className ?? ""}`} />
```

`tailwind-merge` resolves conflicts when later utilities should override earlier ones (e.g., `px-4 px-6` → `px-6`).

### Variants via `cva` when repeated

**[MODERATE]** When a component has 3+ distinct style variants, define them with `class-variance-authority` (`cva`) rather than ad-hoc ternaries:

```ts
import { cva } from "class-variance-authority";
const button = cva("rounded-lg font-medium transition", {
  variants: {
    variant: {
      primary: "bg-accent text-white hover:bg-accent/90",
      ghost: "bg-transparent text-fg hover:bg-surface",
      danger: "bg-danger text-white hover:bg-danger/90",
    },
    size: { sm: "px-3 py-1 text-sm", md: "px-4 py-2", lg: "px-6 py-3 text-lg" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});
```

Don't reach for `cva` when there's only 2 variants and no composition — a `cn()` call is fine.

### Theme tokens

**[HIGH]** Define colors, shadows, and spacing unique to the design system as CSS custom properties in `index.css`, then reference them from the Tailwind config (`tailwind.config.ts`) so utilities like `bg-bg`, `text-fg`, `border-border-light` resolve correctly.

```css
/* index.css */
:root {
  --c-bg: #fff;
  --c-fg: #111;
  --c-border-light: #e5e5e5;
  --shadow-brutal-sm: 3px 3px 0 #000;
}
.dark {
  --c-bg: #0a0a0a;
  --c-fg: #f5f5f5;
  ...
}
```

```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: { bg: "var(--c-bg)", fg: "var(--c-fg)" },
    boxShadow: { "brutal-sm": "var(--shadow-brutal-sm)" },
  },
}
```

Using `bg-bg` over `bg-[var(--c-bg)]` keeps the Tailwind IntelliSense friendly and the codebase greppable.

### Arbitrary values sparingly

**[MODERATE]** Tailwind's `bg-[#fff]` / `w-[317px]` escape hatches are OK for genuinely one-off values. If you use the same magic number 3+ times, extract a theme token.

### Class ordering

**[MODERATE]** Install `prettier-plugin-tailwindcss` once ESLint lands. It reorders classes deterministically. Until then, follow the informal convention: layout → spacing → typography → color → state → responsive.

### Responsive

Use Tailwind's built-in breakpoints (`sm:`, `md:`, `lg:`). Don't introduce custom media queries when a breakpoint suffices.

### Dark mode

Class-based dark mode: toggle `.dark` on `<html>`. Use Tailwind's `dark:` variant:
```tsx
<div className="bg-bg text-fg dark:bg-bg dark:text-fg" />
```

If a color uses a theme token that already differs between light and dark, you don't need the `dark:` variant — the token does the work.

### Global styles

**[HIGH]** Global CSS stays in `src/index.css` (or a dedicated `src/styles/`):
- Theme tokens (CSS custom properties).
- Resets/base (already handled by Tailwind's base).
- A handful of utility classes that repeat everywhere and are ergonomic as a class (`.btn-brutal`, `.card`).

Avoid growing this file — if something is used in one component, style it in that component.

## Anti-patterns

- **Static `style={{}}`** — move to Tailwind classes.
- **Template-literal class strings** — use `cn()`.
- **Re-implementing the same shadow/color combo with inline styles** — extract a utility class or component.
- **`!important`** — nearly always a Tailwind specificity misunderstanding. `tailwind-merge` solves the common case.
- **Mixing Tailwind with CSS Modules for the same component** — pick one per project.
- **Arbitrary value spam** (`bg-[#a1b2c3] text-[13px] leading-[1.23]`) repeated across components — extract tokens.
