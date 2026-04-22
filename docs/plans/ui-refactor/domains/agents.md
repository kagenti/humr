# Domain — agents

Agent templates, agent instances, create/edit flows.

## Files in scope

- `src/views/list-view.tsx` — agents list.
- `src/dialogs/add-agent-dialog.tsx` — agent creation.
- `src/dialogs/edit-agent-secrets-dialog.tsx` — **760-line god dialog** (top priority for step 04 + 05).
- `src/dialogs/instance-settings-dialog.tsx` — per-instance settings.
- `src/components/agent-resolver.ts` — helper, likely moves to utils or module.
- `src/components/app-status-pill.tsx` — status chip.
- `src/instance-trpc.ts` — per-instance tRPC client.
- `src/store/agents.ts`, `src/store/instances.ts`, `src/store/templates.ts` — zustand slices.

Target modules: `src/modules/agents/` + `src/modules/instances/` + `src/modules/templates/`.

## Known specifics

- `edit-agent-secrets-dialog.tsx` has 14 `useState`, 5 `useMemo`, and 7 subcomponents defined inline. Step 04 breaks it into a container + `credentials-tab` + `env-tab` + row components. Step 05 then converts the form to RHF + Zod.
- Manual dirty-tracking (`initialMode`, `initialAssigned`, `initialAppIds` refs) → `formState.isDirty` after step 05.
- `add-agent-dialog.tsx` keeps a local `secrets: SecretView[]` mirror even though the store has one. Step 03 removes the duplicate.
- `instance-settings-dialog.tsx` re-implements Escape-to-close + backdrop click that `<Modal>` already provides. Step 04 deletes the hand-rolled copy.
- Local `classify(s)` / `displayName(s)` duplicate `isMcpSecret()` / `mcpHostnameFromSecretName()` from `types.ts`. Step 07 deletes the duplicates.
- Toggle-Set pattern copied across `edit-agent-secrets-dialog`, `add-agent-dialog`, and at least one panel. Extract `useToggleSet` in step 04.

## Step checklist

| Step | Focus | PR |
|---|---|---|
| 01 structure | three modules: agents, instances, templates | |
| 02 data | list + create + update + delete via TQ; mutations declare `meta.invalidates` | |
| 03 state | remove server mirrors; selector hooks for selected agent, open dialog | |
| 04 splitting | **split `edit-agent-secrets-dialog`**; extract `useToggleSet`; delete backdrop re-impl | |
| 05 forms | **RHF + Zod for the secrets dialog** (14 fields → schema); review add-agent-dialog | |
| 06 styling | agent cards, tab buttons — lots of `shadow-brutal-*` | |
| 07 clean | dedupe classify/displayName; type the agent + secret views cleanly | |

## Smoke flow (verification)

1. Create an agent → list shows it → detail view opens.
2. Edit secrets: add a credential, assign apps, switch mode, save → reopen: values persist.
3. Cancel with unsaved changes → confirm dialog fires.
4. Delete an agent → list updates; if instances exist, they disappear with the parent.
5. Instance settings: open, change, save → agent behavior reflects the change on next run.

**Automation:** Playwright for happy path + form validation. The secrets dialog is the best automated-test target in the whole plan — lots of interactions.
**Fallback:** user test for mode switching + visual polish.
