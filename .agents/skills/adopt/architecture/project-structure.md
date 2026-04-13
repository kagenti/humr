# Project Structure

The project is organized as a monorepo with workspace support.

## Monorepo Layout

```
project-root/
├── package.json                  # Workspace root with "workspaces" field
├── tsconfig.base.json            # Shared strict TypeScript config
├── pnpm-workspace.yaml           # (if using pnpm)
├── packages/
│   ├── server/
│   │   ├── package.json          # @trpc/server, zod
│   │   ├── tsconfig.json         # Extends ../../tsconfig.base.json
│   │   └── src/
│   │       └── modules/          # See modules.md
│   │           └── <module>/     # e.g., identity/, billing/, orders/
│   │               ├── routers/  # Validation layer
│   │               ├── services/ # Application layer
│   │               ├── domain/   # Domain layer
│   │               │   └── events/
│   │               └── index.ts  # Public API
│   ├── client/
│   │   ├── package.json          # @trpc/client (+ framework deps)
│   │   ├── tsconfig.json         # Extends ../../tsconfig.base.json
│   │   └── src/
│   │       └── ...               # UI + tRPC client setup
│   └── <api-contract-pkg>/
│       ├── package.json
│       ├── tsconfig.json         # Extends ../../tsconfig.base.json
│       └── src/
│           └── index.ts          # Exports AppRouter type
└── tseng/
    ├── index.md                  # Entry point — progressive disclosure to other files
    ├── project-structure.md      # Auto-generated project metadata
    └── reviews/
        ├── index.md              # Append-only review history table
        ├── 001.md                # First review (immutable once locked)
        ├── 002.md                # Second review (immutable once locked)
        └── ...                   # One file per review, never modified after locking
```

## Package Responsibilities

### `packages/server/`

The server package contains the API and all backend logic, organized into modules. Each module is a bounded context expressed as a vertical slice containing the three architectural layers (see [slice-composition.md](slice-composition.md) and [modules.md](modules.md)).

**Required dependencies:** `@trpc/server`, `zod`
**Required dev dependencies:** `@types/node`

### `packages/client/`

The client package consumes the API via a typed tRPC client. The UI framework is flexible.

**Required dependencies:** `@trpc/client`

### API contract package

A workspace package that exports the `AppRouter` type and API type definitions for the client to consume. This enables end-to-end type safety without coupling the client directly to server internals. The naming and scope of this package is flexible — it may only re-export types, or it may also contain the router definitions themselves.

## Workspace Configuration

- **pnpm** (default): Uses `pnpm-workspace.yaml` with `packages: ["packages/*"]`
- **npm/yarn**: Uses `"workspaces": ["packages/*"]` in root `package.json`
- **bun**: Uses `"workspaces": ["packages/*"]` in root `package.json`

## TypeScript Configuration

The root `tsconfig.base.json` provides shared strict settings. Each package extends it:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

The server package must add `"types": ["node"]` in its `compilerOptions` since it runs in Node, not the browser.

## Project Metadata (`tseng/project-structure.md`)

After bootstrapping or reviewing, a `tseng/project-structure.md` file records the project layout with machine-readable HTML comments for tooling:

```markdown
<!-- package_manager: pnpm -->
<!-- server_runtime: hono -->
<!-- server_path: packages/server -->
<!-- server_package_name: @myapp/server -->
<!-- client_path: packages/client -->
<!-- client_package_name: @myapp/client -->
<!-- workspace_root: . -->
<!-- workspace_config: pnpm-workspace.yaml -->
```

Valid values for `server_runtime`: `hono` (default), `express`.

This file is the source of truth for other skills that need to locate packages.

## TSEng Index (`tseng/index.md`)

The `tseng/index.md` file is the entry point for all TSEng context in a project. The project's `CLAUDE.md` points here; everything else is discovered through progressive disclosure.

Template (adapt based on which files exist):

```markdown
# TSEng

This project follows the TypeScript Engineering architecture.

## Project Metadata
See [project-structure.md](project-structure.md) for workspace layout, package manager, and server runtime.

## Adoption Progress
See [adoption.md](adoption.md) for applied, discarded, and remaining architecture changes.

## Review History
See [reviews/index.md](reviews/index.md) for the full history of architecture reviews. Each review is an immutable record that is locked once finalized.
```

Only include sections for files that actually exist. For a bootstrapped project, "Project Metadata" and "Review History" will be present. For an adopted project, "Adoption Progress" will also appear.
