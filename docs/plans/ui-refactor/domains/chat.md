# Domain — chat

Chat view, message streaming, sessions, and the ACP WebSocket protocol.

## Files in scope

- `src/views/chat-view.tsx` — main chat view.
- `src/components/chat-input.tsx` — composer.
- `src/panels/sessions-sidebar.tsx` — session list / switcher.
- `src/components/permission-prompt.tsx` — inline permission request UI.
- `src/components/session-config-popover.tsx` — per-session config.
- `src/hooks/use-acp-session.ts` — **602-line god hook** (top priority for step 04).
- `src/acp.ts` — ACP client glue.
- `src/session-projection.ts` — stream-to-state projection utilities.
- `src/store/sessions.ts`, `src/store/session-config.ts`, `src/store/permissions.ts` — zustand slices.

Target modules: `src/modules/sessions/` + `src/modules/acp/` (they are sibling modules — `acp` owns the protocol; `sessions` owns the chat UX).

## Known specifics

- `use-acp-session.ts` holds 11 `useRef` + 13 `useState` + 5+ `useEffect`. Step 04 splits it into `use-acp-connection`, `use-acp-session-list`, `use-acp-config-cache`, `use-acp-streaming-updates`, and a thin orchestrator `use-acp-session`.
- ACP message types are currently `any` at the boundary. Step 07 defines Zod schemas in `modules/acp/api/types.ts` for `UpdateHandler`, `requestPermission`, `handleConfigUpdate`, `applyConfig` — this also reduces surface area for step 04.
- Session-list fetch currently lives inside the god hook. Step 02 pulls it out into a TQ query (`useAcpSessions()`), which simplifies step 04.
- Streaming finalization (grouping replayed user chunks) is subtle — PR #217 is the reference behavior. Don't regress it.

## Step checklist

| Step | Focus | PR |
|---|---|---|
| 01 structure | move into `modules/sessions/` + `modules/acp/` | |
| 02 data | session list → TQ; config cache → TQ with localStorage persister | |
| 03 state | selector hooks for open session id, pending permissions; drop server mirrors | |
| 04 splitting | **split `use-acp-session.ts`** — biggest single refactor in this plan | |
| 05 forms | session-config-popover likely below threshold; verify | |
| 06 styling | chat bubbles, tool chips, permission prompts — audit inline styles | |
| 07 clean | **Zod schemas for ACP messages**; dedupe tool-chip formatters | |

## Smoke flow (verification)

1. Open a chat, send a message, confirm streaming tokens render, confirm final message persists.
2. Switch sessions; verify state isolation (pending message in A doesn't leak into B).
3. Trigger a permission prompt (tool-call that requires approval), approve, verify continuation.
4. Simulate connection drop (stop agent pod briefly) — UI should show disconnected state and reconnect cleanly.
5. Reload mid-stream — last message state is preserved (PR #248 behavior).

**Automation:** Playwright can script the happy path end-to-end. Streaming + reconnect behavior is the hardest part; at minimum assert messages arrive and reconnect doesn't duplicate.
**Fallback:** user test for the reconnect + permission-prompt UX.
