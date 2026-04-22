# UI refactor plan — `packages/ui`

**Scope:** first-pass refactor of humr's `packages/ui` toward the [React + TypeScript UI engineering skill](../../../.agents/skills/react-ui-engineering/SKILL.md). Target state, rules, and severity tiers live in the skill; this document lists the concrete legacy hotspots and fix recipes. Delete once the work is done.

**Read when:** touching a file in `packages/ui` and deciding what to migrate while you're there.

**Policy:** touch-it = migrate-it. Don't batch rewrites across unrelated code in one PR. Large single-area refactors (e.g., splitting `use-acp-session.ts`) get their own PR.

---

## Target module layout

Current humr layout is flat by technical layer:
```
src/
├── components/  (23 files, flat)
├── dialogs/     (6 files)
├── views/       (5 files)
├── panels/      (7 files)
├── hooks/       (4 files)
├── store/       (12 slice files)
└── lib/         (2 files)
```

Target: domain modules per [`references/project-structure.md`](../../../.agents/skills/react-ui-engineering/references/project-structure.md). Proposed modules:
`agents`, `instances`, `sessions`, `acp`, `secrets`, `connections`, `schedules`, `templates`, `files`, `platform` (tRPC + auth).

Shared (stays at top level):
- `components/` — primitives only: `modal.tsx`, `button.tsx`, `status-indicator.tsx`, `toast-overlay.tsx`, `markdown.tsx`, icons.
- `hooks/` — generic only (e.g., `use-auto-resize.ts`).
- `utils/` — format/classification helpers with no domain.

## File conventions for humr

- **Naming:** kebab-case for all `.ts`/`.tsx` files — consistent with the current codebase.
- **Imports:** keep relative imports with `.js` extensions for now. Path aliases are out of scope for this refactor.
- **Styling:** Tailwind only. Theme-aware values via CSS custom properties in `index.css`; dark mode via class-based `.dark` on `<html>`.

---

## Concrete legacy hotspots

---

## 1. God component: 760-line dialog

**Location:** `src/dialogs/edit-agent-secrets-dialog.tsx`.
**Symptom:** 760 lines, 14 `useState`, 5 `useMemo`, 7 subcomponents defined in the same file.
**Why bad:** Multi-tab form + credentials + env vars + apps + modes all live in one function. Change-impact is the whole file.

**Fix recipe:**
1. Move to `src/modules/secrets/components/edit-agent-secrets-dialog/`.
2. Split tabs: `credentials-tab.tsx`, `env-tab.tsx`.
3. Extract row-level components: `inherited-env-row.tsx`, `apps-group.tsx`, `app-row.tsx`, `mode-card.tsx`, `tab-button.tsx`.
4. Replace the 14 `useState` with RHF + Zod ([`references/forms.md`](../../../.agents/skills/react-ui-engineering/references/forms.md)).
5. Replace manual dirty-tracking (`initialMode`, `initialAssigned`, `initialAppIds` refs) with `formState.isDirty`.
6. Delete the hand-rolled `classify()` and `displayName()` — use `isMcpSecret()`, `mcpHostnameFromSecretName()` from `types.ts`.

Target: container ~120 lines, each tab ~150 lines, rows ~50 lines each.

---

## 2. God hook: 602-line `use-acp-session`

**Location:** `src/hooks/use-acp-session.ts`.
**Symptom:** 11 `useRef`, 13 `useState`, 5+ `useEffect`. Manages WebSocket, session list, config cache, update routing, streaming finalization.
**Why bad:** Impossible to test, every change has app-wide blast radius.

**Fix recipe:** split by lifecycle into `src/modules/acp/hooks/`:
- `use-acp-connection.ts` — socket open/close/reconnect, `send`.
- `use-acp-session-list.ts` — list as a TQ query.
- `use-acp-config-cache.ts` — fetch + localStorage cache.
- `use-acp-streaming-updates.ts` — message projection + update routing (wraps existing `session-projection` utilities).
- `use-acp-session.ts` — thin orchestrator composing the above (~50 lines).

Also: the `any`-typed protocol surface (`UpdateHandler`, `requestPermission`, `handleConfigUpdate`, `applyConfig`) becomes Zod schemas in `modules/acp/api/types.ts` and gets proper inference.

---

## 3. Fetch-in-component loading/error/data trio

**Locations:** `connections-view.tsx`, `add-agent-dialog.tsx`, `edit-agent-secrets-dialog.tsx`, `edit-secret-dialog.tsx`, `schedules-panel.tsx`.
**Symptom:** ~5+ files each with:
```tsx
const [loading, setLoading] = useState(true);
const [data, setData] = useState<T[]>([]);
const [error, setError] = useState<string | null>(null);
useEffect(() => {
  (async () => {
    try { setData(await platform.xxx.list.query()); }
    catch (e) { setError(toMsg(e)); }
    finally { setLoading(false); }
  })();
}, []);
```

**Fix recipe:**
- Convert to `@trpc/react-query`: `trpc.xxx.list.useQuery()`.
- Wrap in a domain hook: `useConnections()`, `useSecrets()`, etc.
- Delete the useState triad; use `{ data, isLoading, error }` from the hook.

See [`references/async-data.md`](../../../.agents/skills/react-ui-engineering/references/async-data.md) for the migration block.

---

## 4. Server state in Zustand + local `useState` duplicate

**Location:** `add-agent-dialog.tsx` keeps `const [secrets, setSecrets] = useState<SecretView[]>([])` even though `useStore(s => s.secrets)` exists.
**Symptom:** Two sources of truth for "the list of secrets", each with its own load lifecycle, each potentially stale.
**Why bad:** classic duplication bug. Users see stale data or see a flash of empty state after the store already had the data.

**Fix recipe:**
- Server list → TQ (`useSecrets()`).
- Dialog reads from the hook directly; no local mirror.
- Delete the per-slice fetch in Zustand (`store/secrets.ts` `fetchSecrets`) once no one calls it.

---

## 5. Manual dialog backdrop reimplementation

**Location:** `src/dialogs/instance-settings-dialog.tsx` reimplements Escape-to-close + backdrop click handling that `src/components/modal.tsx` already provides.
**Fix recipe:** use `<Modal>` directly. Delete the hand-rolled copy.

---

## 6. Duplicated classification / formatting

**Location:** `edit-agent-secrets-dialog.tsx` defines `classify(s)` and `displayName(s)` locally; `types.ts` already exports `isMcpSecret()` and `mcpHostnameFromSecretName()`.
**Fix recipe:** delete local versions, import shared ones. Grep for copy-pastes before adding any new classifier.

---

## 7. Toggle-Set pattern copied everywhere

**Locations:** `edit-agent-secrets-dialog.tsx`, `add-agent-dialog.tsx`, and at least one panel.
**Symptom:**
```ts
const toggle = (id: string) =>
  setAssigned((p) => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
```

**Fix recipe:** extract to `src/hooks/use-toggle-set.ts`:
```ts
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

---

## 8. Inline nested JSX mapping

**Location:** `connections-view.tsx:201–247` — 40+ lines of nested JSX inside `appConnections.map(...)`.
**Fix recipe:** extract `<AppConnectionRow connection={c} onDisconnect={...} />` as its own file.

---

## 9. Static inline `style={{}}`

**Symptom:** ~76 instances across humr with static `style={{ boxShadow: "var(--shadow-brutal-*)", ... }}`.
**Fix recipe:** either:
- Extend Tailwind config to expose a `shadow-brutal-sm` utility bound to the CSS var.
- Or extract a component / class that carries the shadow.

Use `style={{}}` only for runtime-variable values (progress width, dynamic color).

---

## 10. Inline `useStore(s => ...)` in components

**Locations:** Everywhere a Zustand value is consumed (`app.tsx:15–40`, every view and dialog).
**Symptom:**
```tsx
const view = useStore((s) => s.view);
const fetchAgents = useStore((s) => s.fetchAgents);
const theme = useStore((s) => s.theme);
```
**Fix recipe:** export selector hooks from each slice file. Components import `useView()`, `useTheme()`, `useAgentsActions()`. See [`references/state-management.md`](../../../.agents/skills/react-ui-engineering/references/state-management.md) for the pattern.

---

## 11. `any` at protocol boundary

**Locations:** `acp.ts`, `use-acp-session.ts` (multiple params of `any`).
**Fix recipe:** define Zod schemas for the ACP messages in `src/modules/acp/api/types.ts`; parse at the boundary; `z.infer` the types.

---

## 12. Mega-form useState (14 fields)

Covered by #1 above. The fix is RHF + Zod; see [`references/forms.md`](../../../.agents/skills/react-ui-engineering/references/forms.md).

---

## 13. No query key discipline / no invalidation graph

**Symptom:** Store actions do `await fetchAgents(); await fetchInstances();` after a mutation — manual invalidation, easy to forget, drifts over time.
**Fix recipe:** move to TQ, invalidate via `meta.invalidates: [agentKeys.list(), instanceKeys.list()]`. One place, centrally handled.

---

## 14. Mixed authFetch + tRPC without convention

**Locations:** `connections-view.tsx` uses both `platform.xxx.query()` and `authFetch("/api/oauth/start", ...)` inline.
**Fix recipe:** tRPC where the server exposes it; typed fetcher in `modules/{domain}/api/index.ts` for non-tRPC endpoints. Never raw `authFetch` in components. See [`references/api-layer.md`](../../../.agents/skills/react-ui-engineering/references/api-layer.md).

---

## 15. No ESLint enforcement at package level

**Symptom:** Root installs ESLint; the `packages/ui` project doesn't run it.
**Fix recipe:** out of scope for the skill; the skill relies on Claude to enforce the rules until a future iteration bundles lint config.

---

## How to use this list

1. When starting a task in humr, check if you're in one of these files. If yes, the fix recipe tells you the minimal correct direction.
2. When *adding* to a file in this list, don't bolt new code onto the drift. Do the local fix before adding.
3. Don't try to fix all 15 in one PR. Touch one, fix that one.
4. New code never introduces any of these patterns in the first place.
