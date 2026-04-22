# Step 02 — Data layer

**Goal:** isolate all server communication into `modules/{domain}/api/`, migrate to TanStack Query (via `@trpc/react-query` for tRPC, typed fetchers + Zod otherwise), and adopt query-key factories.

**Skill references:**
- [`references/api-layer.md`](../../../../.agents/skills/react-ui-engineering/references/api-layer.md)
- [`references/async-data.md`](../../../../.agents/skills/react-ui-engineering/references/async-data.md)

**Preconditions:** step 01 (project structure) complete for this domain.

---

## Scope

1. Every raw `fetch` / `authFetch` call inside components, dialogs, views, or panels.
2. Every direct `platform.xxx.query()` / `platform.xxx.mutation()` call.
3. Every useState/useEffect loading-error-data triad backing a server call.
4. Every "manual invalidation" (calling `fetchX()` after a mutation resolves).

## Recipe

### Fetch-in-component triad → TQ hook

Anti-pattern:

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

Fix:

```tsx
// modules/{domain}/api/queries.ts
export const useXxxList = () => trpc.xxx.list.useQuery();
```

Components consume `{ data, isLoading, error }` from the hook. Delete the triad and the `useEffect`.

### Query-key factory per domain

```ts
// modules/{domain}/api/keys.ts
export const xxxKeys = {
  all: ['xxx'] as const,
  list: () => [...xxxKeys.all, 'list'] as const,
  detail: (id: string) => [...xxxKeys.all, 'detail', id] as const,
};
```

All query / mutation / invalidation sites import from the factory. No string-literal keys.

### Mutations use `meta.invalidates`

Centralize cache invalidation in the QueryClient:

```ts
// app-level queryClient config
const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      onSuccess: (_data, _vars, _ctx, mutation) => {
        const invalidates = mutation.meta?.invalidates as QueryKey[] | undefined;
        invalidates?.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      },
    },
  },
});
```

Then each mutation declares what it affects:

```ts
// modules/{domain}/api/mutations.ts
export const useDeleteXxx = () =>
  trpc.xxx.delete.useMutation({ meta: { invalidates: [xxxKeys.list()] } });
```

No more `await fetchAgents(); await fetchInstances();` chains in store actions.

### Non-tRPC endpoints get typed fetchers

For REST or OAuth endpoints (e.g., `/api/oauth/start`):

```ts
// modules/{domain}/api/fetchers.ts
const oauthStartSchema = z.object({ url: z.string().url(), state: z.string() });

export async function startOAuth(provider: string) {
  const res = await authFetch(`/api/oauth/start?provider=${provider}`);
  if (!res.ok) throw new HttpError(res.status, await res.text());
  return oauthStartSchema.parse(await res.json());
}
```

Wrap in a mutation hook if it mutates server state, otherwise a query hook.

### Component-level error surfacing

Mutation errors: configured once in the QueryClient (see `meta.errorToast` in the skill reference). Query errors: component reads `query.error` and renders a banner / retry.

## Definition of done

- No `fetch` / `authFetch` / `platform.xxx.query()` call in any component, dialog, view, or panel for this domain.
- No loading/error/data `useState` triad for server data.
- All queries and mutations live in `modules/{domain}/api/` and are imported as hooks.
- Query-key factory exists; no string-literal keys remain in the domain.
- Mutations declare `meta.invalidates`; store actions doing manual invalidation for this domain's resources are removed.
- `mise run check` green.

## How to verify

1. **`mise run check`** — must pass.
2. **Grep for regressions:**
   - `grep -r "fetch(" src/modules/{domain}/ | grep -v "api/"` → should be empty.
   - `grep -r "useState.*\[\]" src/modules/{domain}/ | grep -i "load\|error"` → should be empty.
3. **Playwright or user test** — exercise the domain's primary CRUD flow:
   - List page loads (no spinner stuck).
   - Create → list reflects the new item without a manual refresh.
   - Update → detail view reflects new values.
   - Delete → list loses the item.
4. **Network panel spot check** — the invalidation graph should fire one request per affected list after a mutation, not N redundant ones.
