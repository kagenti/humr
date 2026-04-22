# Domain — settings

Theme, navigation, onboarding, providers, global configuration.

## Files in scope

- `src/views/settings-view.tsx` — settings shell.
- `src/views/providers-view.tsx` — provider picker (Anthropic API key / OAuth, etc.).
- `src/panels/configuration-panel.tsx` — global config.
- `src/panels/channels-panel.tsx` — notification channels (Telegram, etc.).
- `src/panels/mcps-panel.tsx` — MCP server registry.
- `src/panels/log-panel.tsx` — log viewer.
- `src/components/setup-progress-bar.tsx` — sticky onboarding bar (PR #199, #247).
- `src/components/sidebar.tsx`, `src/components/mobile-nav.tsx` — navigation.
- `src/store/theme.ts`, `src/store/navigation.ts`, `src/store/dialog.ts`, `src/store/loading.ts`, `src/store/toast.ts`, `src/store/toast-sink.ts` — zustand slices.

Target module: `src/modules/settings/` (or `platform/` — decide in step 01; platform may better suit the nav + theme + toast primitives).

This is the messiest domain — it bundles a lot of cross-cutting UI primitives with actual settings pages. Spend extra time in step 01 on classification.

## Known specifics

- `app.tsx` reads a pile of values via inline `useStore((s) => s.x)` (view, theme, fetchAgents, etc.). Step 03 rewrites these as selector hooks. This touches nearly every slice.
- `theme.ts` store handles the `.dark` class on `<html>`. Keep that behavior after step 03.
- Onboarding setup-progress-bar derives state from multiple slices — good candidate for a dedicated derived-state hook in step 04.
- `providers-view.tsx` has forms for API key / OAuth token entry — step 05 converts to RHF + Zod.
- `mcps-panel.tsx` uses `use-mcp-picker.ts` hook — may be worth lifting into the module.

## Step checklist

| Step | Focus | PR |
|---|---|---|
| 01 structure | classify primitives (sidebar, mobile-nav, toast) vs settings-specific | |
| 02 data | TQ for providers, channels, MCPs, global config | |
| 03 state | **biggest state-cleanup surface** — selector hooks for app.tsx and across panels | |
| 04 splitting | setup-progress-bar derives across slices → dedicated hook | |
| 05 forms | RHF + Zod for providers-view forms | |
| 06 styling | theme toggle, sidebar, mobile nav — high visual-regression risk | |
| 07 clean | dedupe log formatters; type MCP + channel shapes | |

## Smoke flow (verification)

1. Toggle theme → `.dark` class toggles on `<html>`; reload preserves theme.
2. Switch view via sidebar → correct panel loads; URL updates if URL-driven.
3. Mobile nav → same navigation flow works on narrow viewport.
4. Providers: enter an Anthropic API key + Test button → success state (PR #270).
5. MCPs panel: add/remove MCP server → config reloads.
6. Onboarding progress bar: fresh state shows pending steps; completing each step updates the bar.
7. Toast: trigger an error → toast appears → auto-dismisses.

**Automation:** Playwright for navigation, theme toggle, provider setup, toast.
**Fallback:** user test for visual polish across breakpoints, dark/light transitions, onboarding feel.
