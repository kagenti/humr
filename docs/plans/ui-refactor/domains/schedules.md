# Domain — schedules

Cron-style scheduled agent runs.

## Files in scope

- `src/panels/schedules-panel.tsx` — list + create + edit.
- `src/store/schedules.ts` — zustand slice.

Target module: `src/modules/schedules/`.

## Known specifics

- `schedules-panel.tsx` has a fetch-in-component triad for schedule loading. Step 02 converts to `useSchedules()`.
- Cron expression input — validate with a Zod schema + helper parser in step 05. No free-form `useState` for cron strings.
- This is the smallest domain; several steps will be near-no-ops.

## Step checklist

| Step | Focus | PR |
|---|---|---|
| 01 structure | move into `modules/schedules/` | |
| 02 data | TQ for list + CRUD | |
| 03 state | drop server mirror; selector for selected schedule | |
| 04 splitting | panel should be small — skip unless it grew | |
| 05 forms | RHF + Zod for schedule create/edit (cron regex) | |
| 06 styling | likely near-no-op | |
| 07 clean | type the schedule shape cleanly; no `any` on cron | |

## Smoke flow (verification)

1. Create a schedule with a valid cron → list shows it with next-run timestamp.
2. Invalid cron string → validation error inline.
3. Edit → changes persist.
4. Delete → removed.
5. Toggle "enabled" — paused schedules don't fire (only verifiable in integration).

**Automation:** Playwright for CRUD + validation.
**Fallback:** user test to confirm a scheduled run actually fires on the expected tick (integration concern, not strictly UI).
