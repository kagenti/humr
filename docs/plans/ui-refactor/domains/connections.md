# Domain — connections

OAuth / app-connection management (Slack, Google Workspace, etc.).

## Files in scope

- `src/views/connections-view.tsx` — primary view.
- `src/dialogs/connect-slack-dialog.tsx` — Slack OAuth flow dialog.
- `src/dialogs/connection-env-helpers.ts` — env-var helpers for connection secrets.
- `src/store/connections.ts` — zustand slice.
- Portions of `src/components/connections-picker.tsx` that are connection-specific.

Target module: `src/modules/connections/`.

## Known specifics

- Mixes `platform.xxx.query()` with raw `authFetch("/api/oauth/start", ...)`. Step 02 must handle both flavors — tRPC via `@trpc/react-query`, REST/OAuth via typed fetchers with Zod validation.
- `connections-view.tsx:201–247` has 40+ lines of inline nested JSX inside `appConnections.map(...)` — extract `<AppConnectionRow>` in step 04.
- Post-OAuth redirect: watch for window-focus refetch behavior. TQ's `refetchOnWindowFocus` should do the right thing; verify after step 02.

## Step checklist

| Step | Focus | PR |
|---|---|---|
| 01 structure | move files into `modules/connections/` | |
| 02 data | tRPC hooks + typed OAuth fetchers; invalidate `connectionKeys.list()` on (dis)connect | |
| 03 state | drop server-state mirrors; selector hooks for UI state (selected provider, open dialog) | |
| 04 splitting | extract `AppConnectionRow`, break `connect-slack-dialog` if > ~300 lines | |
| 05 forms | review env-mapping edits; likely ≥3 fields → RHF+Zod | |
| 06 styling | static-style audit; the connection cards use `shadow-brutal-*` | |
| 07 clean | types for OAuth response shapes; dedupe env-helpers | |

## Smoke flow (verification)

1. Open `/connections`.
2. Click "Connect Slack" → OAuth popup → complete flow → card shows connected state without manual refresh.
3. Disconnect → card returns to disconnected, no stale "connected" flash.
4. Edit env mapping → save → close → reopen → values persisted.

**Automation:** Playwright — the OAuth redirect is the only tricky part; stub the provider at the network layer or use a preconfigured dev provider.
**Fallback:** user test for the OAuth leg specifically.
