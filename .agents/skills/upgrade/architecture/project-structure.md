# Project Structure

The project is organized as a monorepo with workspace support.

## Monorepo Layout

```
project-root/
├── package.json                  # Workspace root with "workspaces" field
├── tsconfig.base.json            # Shared strict TypeScript config
├── pnpm-workspace.yaml           # (if using pnpm)
├── packages/
│   ├── <server-pkg>/             # One or more server packages (name is flexible)
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
│   ├── <client-pkg>/             # One or more client packages (name is flexible)
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

Package names are **not enforced** — projects may use any naming convention (e.g., `api-server`, `backend`, `web`, `ui`, `dashboard`). What matters is the role (server vs client) and the internal structure, not the directory name. A project may also have multiple server or client packages.

## Package Responsibilities

### Server packages

Each server package contains an API and backend logic, organized into modules. Each module is a bounded context expressed as a vertical slice containing the three architectural layers (see [slice-composition.md](slice-composition.md) and [modules.md](modules.md)). A project may have one or more server packages.

**Required dependencies:** `@trpc/server`, `zod`
**Required dev dependencies:** `@types/node`

### Client packages

Each client package consumes an API via a typed tRPC client. The UI framework is flexible. A project may have one or more client packages.

**Required dependencies:** `@trpc/client`

### API contract package

A workspace package that exports the `AppRouter` type and API type definitions for the client to consume. This enables end-to-end type safety without coupling the client directly to server internals. The naming and scope of this package is flexible — it may only re-export types, or it may also contain the router definitions themselves.

### Other packages

The monorepo may contain packages that fall outside the scope of this architecture (e.g., packages in a different language, shared utilities, infrastructure tooling). These should be listed in `tseng/project-structure.md` under the `other` role so the architecture is aware of them but does not attempt to enforce rules on them.

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

After bootstrapping or reviewing, a `tseng/project-structure.md` file records the project layout with machine-readable HTML comments for tooling.

Each package is listed with a `role` (`server`, `client`, `contract`, or `other`), its `path`, and its `package_name`. Multiple packages of the same role are supported.

```markdown
<!-- package_manager: pnpm -->
<!-- workspace_root: . -->
<!-- workspace_config: pnpm-workspace.yaml -->

<!-- package: api-server | role: server | runtime: hono | path: packages/api-server | package_name: @myapp/api-server -->
<!-- package: ui | role: client | path: packages/ui | package_name: @myapp/ui -->
<!-- package: dashboard | role: client | path: packages/dashboard | package_name: @myapp/dashboard -->
<!-- package: api-types | role: contract | path: packages/api-types | package_name: @myapp/api-types -->
<!-- package: scripts | role: other | path: packages/scripts | package_name: @myapp/scripts -->
```

Valid values for `runtime` (server packages only): `hono` (default), `express`.

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
