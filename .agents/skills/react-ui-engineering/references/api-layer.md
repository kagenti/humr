# API layer

**Read when:** writing a fetch call, setting up tRPC, adding error handling, organizing API modules, validating responses, consuming a new endpoint.

## Principles

**[CRITICAL] Server I/O is isolated from UI.** Components never call `fetch`, `authFetch`, or tRPC procs directly. They import a query/mutation hook from their module's `api/` folder. The fetcher layer knows about URLs, auth, parsing, and typed errors; the UI knows about hooks returning `{ data, isLoading, error, mutate }`.

**[HIGH] Every non-tRPC response is Zod-validated** before reaching application code. tRPC already gives you end-to-end types; raw `fetch` does not — Zod is the safety net.

## Layers

```
UI component
    ↓ imports
Query/mutation hook  (modules/{domain}/api/queries|mutations/*)
    ↓ calls
Fetcher              (modules/{domain}/api/index.ts — for non-tRPC)
                     (or trpc.{domain}.{proc}.useQuery — for tRPC)
    ↓ uses
Root client          (src/api/trpc.ts, src/api/auth-fetch.ts)
```

Each layer has one concern. Crossing a layer in either direction is a smell.

## Root clients

```ts
// src/api/trpc.ts
export const trpc = createTRPCReact<AppRouter>();

// src/api/auth-fetch.ts
export async function authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// src/api/query-client.ts — see references/async-data.md for full config
export function buildQueryClient() { ... }
```

These are the only places that know how to make a raw HTTP call in the app.

## Fetcher functions (non-tRPC)

Each domain's `api/index.ts` exports typed, Zod-validated fetchers:

```ts
// src/modules/connections/api/index.ts
import { z } from "zod";
import { authFetch } from "#/api/auth-fetch";
import { ApiError } from "#/api/errors";

const oauthStartResponseSchema = z.object({ redirectUrl: z.string().url() });

export async function startOauth(connectorId: string) {
  const res = await authFetch(`/api/oauth/start?connector=${encodeURIComponent(connectorId)}`);
  if (!res.ok) throw await ApiError.fromResponse(res);
  return oauthStartResponseSchema.parse(await res.json());
}

export async function disconnectMcp(connectionId: string) {
  const res = await authFetch(`/api/mcp/connections/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await ApiError.fromResponse(res);
}
```

Notes:
- **One exported function per endpoint.**
- **Inputs are typed parameters.** Don't accept `any` or an untyped record.
- **Responses are Zod-parsed** at the edge. If it's a 204 No Content, no parser needed; otherwise, schema.
- **URL construction encodes user-supplied values** (`encodeURIComponent`). Never string-concatenate user input into paths.
- **On non-OK responses, throw `ApiError`.** Don't return an error object — callers can't tell success from failure.

## Errors

**[HIGH]** A typed error hierarchy. Minimum:

```ts
// src/api/errors.ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message?: string,
  ) {
    super(message ?? `Request failed with ${status}`);
  }
  static async fromResponse(res: Response) {
    const body = await safeJson(res);
    return new ApiError(res.status, body, extractMessage(body) ?? res.statusText);
  }
}

export function isUnauthorized(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 401;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

export function getErrorTitle(err: unknown): string | undefined {
  if (err instanceof ApiError && err.status === 403) return "Permission denied";
  if (err instanceof ApiError && err.status === 404) return "Not found";
  if (isUnauthorized(err)) return "Session expired";
  return undefined;
}
```

These three helpers (`isUnauthorized`, `getErrorMessage`, `getErrorTitle`) are what the MutationCache / QueryCache centralized error handlers use. See `references/async-data.md` for the QueryClient config.

### Extending for domain errors

If a module has structured errors worth distinguishing (e.g., "agent creation failed because of quota"), extend `ApiError`:

```ts
export class QuotaExceededError extends ApiError { ... }
```

Throw from the fetcher when the response body matches. Consumers can now `err instanceof QuotaExceededError`.

## tRPC

With `@trpc/react-query`, the tRPC layer collapses — procs become hooks directly:

```ts
const agents = trpc.agents.list.useQuery();
const createAgent = trpc.agents.create.useMutation({
  meta: { invalidates: [agentKeys.list()], errorToast: { title: "Couldn't create agent" } },
});
```

For error handling: tRPC throws `TRPCClientError`, which has a `shape` field and a `data` with status info. Extract a helper:

```ts
// src/api/trpc-errors.ts
export function isTrpcUnauthorized(err: unknown): boolean {
  return err instanceof TRPCClientError && err.data?.httpStatus === 401;
}
```

Normalize into the common `getErrorMessage` / `getErrorTitle` helpers so the rest of the app doesn't care whether the error came from tRPC or raw fetch.

## Per-instance clients

When you need per-scope tRPC clients (e.g., one client per runtime instance or authenticated tenant), use a scoped provider:

```tsx
// src/modules/instances/contexts/instance-trpc.tsx
const InstanceTrpcContext = createContext<InstanceTrpc | null>(null);

export function InstanceTrpcProvider({ instanceId, children }: Props) {
  const client = useMemo(() => createInstanceTrpc(instanceId), [instanceId]);
  return <InstanceTrpcContext.Provider value={client}>{children}</InstanceTrpcContext.Provider>;
}

export function useInstanceTrpc() {
  const ctx = useContext(InstanceTrpcContext);
  if (!ctx) throw new Error("useInstanceTrpc must be used within InstanceTrpcProvider");
  return ctx;
}
```

Wrap the scoped subtree in the provider; consumers use `useInstanceTrpc()` and its `.useQuery()` / `.useMutation()` on procs.

## Migrating a fetch-site

Typical legacy shape: a component with `useEffect` + `useState` doing its own fetch, plus ad-hoc error handling.

Target shape:
- All server calls behind `useXxx` hooks in `modules/{domain}/api/`.
- Raw `fetch` is confined to `src/api/auth-fetch.ts` and to non-tRPC fetcher functions.
- Errors flow through `ApiError` + `getErrorMessage` + the MutationCache handler.

Concrete step when you touch a fetch-site:
1. Identify the domain it belongs to.
2. Create (or extend) `src/modules/{domain}/api/index.ts` with a typed fetcher.
3. Create a query or mutation hook under `api/queries/` or `api/mutations/`.
4. Replace the component's `useEffect` + `useState` with the hook.

## Anti-patterns

- **`fetch` inside a component** — move to a fetcher + hook.
- **`authFetch` inside a component** — same.
- **Untyped / unvalidated JSON** — run it through Zod.
- **Returning an error object instead of throwing** — callers can't branch correctly; throw.
- **Catching and swallowing errors** — unless you truly mean to, `catch {}` is a bug. Let the QueryClient handle it via `onError`.
- **String-interpolating user input into URLs** — `encodeURIComponent` or use a structured client.
- **Per-call `try/catch` + `showToast`** — centralize in `meta.errorToast`.
- **Custom retry/cache logic in a store slice** — TQ owns this.
