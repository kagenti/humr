# TypeScript Engineering Architecture

Opinionated architecture for TypeScript client-server projects. Read this overview first to understand the full picture, then drill into specific files for details.

## Topics

- **[Stack](stack.md)** — Technology choices: tRPC, Zod, Hono/Express, strict TypeScript, pnpm. Server runtime, client setup, dev proxy, shared types.
- **[Slice Composition](slice-composition.md)** — The three horizontal layers within each vertical slice in server packages: validation (tRPC routers) → application (services) → domain (pure TS). Dependency rules, error handling.
- **[Modules](modules.md)** — Bounded contexts as vertical slices. Module definition (contract package: types + router) vs module implementation (server package: 3-layer stack). Module isolation, `index.ts` as public API boundary, intra-module layer rules. Links to [module boundaries](module-boundaries.md) for loose coupling and inter-module communication via domain events.
- **[Project Structure](project-structure.md)** — Monorepo layout, package responsibilities, workspace config, TypeScript config, project metadata format.
