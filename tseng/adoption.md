# Adoption State

## Applied
- Uses tRPC for API layer — applied on 2026-04-13 (review #001)
- Uses Zod for input validation — applied on 2026-04-13 (review #001)
- TypeScript strict mode via tsconfig.base.json — applied on 2026-04-13 (review #001)
- pnpm workspace support — applied on 2026-04-13 (review #001)
- Hono server runtime with tRPC adapter — applied on 2026-04-13 (review #001)
- tRPC router mounted on server — applied on 2026-04-13 (review #001)
- tRPC client for type-safe API calls — applied on 2026-04-13 (review #001)
- API contract packages export AppRouter type — applied on 2026-04-13 (review #001)
- CORS configured for development — applied on 2026-04-13 (review #001)
- Three-layer architecture: routers/services/domain — applied on 2026-04-13 (review #001)
- Validation layer uses tRPC + Zod, no business logic — applied on 2026-04-13 (review #001)
- Application layer (services/) with port interfaces — applied on 2026-04-13 (review #001)
- Domain layer pure TypeScript, zero external deps — applied on 2026-04-13 (review #001)
- Inward-only dependency flow: routers → services → domain — applied on 2026-04-13 (review #001)
- Services never import from validation layer — applied on 2026-04-13 (review #001)
- Domain layer never imports from other layers — applied on 2026-04-13 (review #001)
- Modules organized under src/modules/ as vertical slices — applied on 2026-04-13 (review #001)
- Modules defined by business boundaries — applied on 2026-04-13 (review #001)
- Each module has routers/services/domain/index.ts — applied on 2026-04-13 (review #001)
- Module index.ts exports only domain events — applied on 2026-04-13 (review #001)
- Domain events in domain/events/ — applied on 2026-04-13 (review #001)
- No cross-module imports except via index.ts — applied on 2026-04-13 (review #001)
- Events named in past tense — applied on 2026-04-13 (review #001)
- Events have type discriminant and type guard — applied on 2026-04-13 (review #001)
- Monorepo with pnpm-workspace.yaml — applied on 2026-04-13 (review #001)
- Server packages have @trpc/server and zod — applied on 2026-04-13 (review #001)
- Client packages have @trpc/client — applied on 2026-04-13 (review #001)
- Root tsconfig.base.json with strict settings — applied on 2026-04-13 (review #001)
- Package tsconfigs extend root tsconfig.base.json — applied on 2026-04-13 (review #001)

## Discarded

(none)

## Remaining
- Domain errors as Result<T, E> values — Result type available in shared/domain/result.ts but not yet adopted in service ports (they return null for not-found)
