# Modules and Bounded Contexts

The server is organized into **modules**. Each module is a vertical slice that represents a single bounded context from the domain.

## Core Concepts

### Bounded Contexts

A bounded context is a boundary where a specific domain model and language applies. The same real-world concept (e.g., "User") can have different representations in different contexts:

- In **Identity**, a User has credentials, sessions, and login history.
- In **Billing**, a Customer has a payment method, invoices, and a subscription plan.
- In **Shipping**, a Recipient has an address and delivery preferences.

Each bounded context owns its own domain model. There is no single unified model — each context models only what it needs.

### Modules as Vertical Slices

A module is the code-level expression of a bounded context. It is a vertical slice that contains all three architectural layers:

| Lens | What it answers |
|------|----------------|
| **Bounded context** (strategic DDD) | What are the boundaries of this domain model? |
| **Vertical slice** (architecture) | How do we structure the code to reflect that boundary? |
| **Module** (codebase) | What is the folder called? |

These are three views of the same thing. A module maps 1:1 to a bounded context.

**Modules are defined by business boundaries, not technical concerns.** `identity/`, `billing/`, `orders/` are valid modules. `database/`, `middleware/`, `utils/` are not.

## Module Definition vs Module Implementation

A module exists in two forms depending on the package:

- **Module definition** (contract package) — Defines *what* the module exposes: types, service interface, and a tRPC router that delegates to the service interface. Flat structure, no layers.
- **Module implementation** (server package) — Implements *how* the module works: business logic organized into the three architectural layers (routers/services/domain).

### Contract Package — Module Definition

Each module in the contract package is flat:

```
packages/api-contract/src/
  modules/
    identity/
      types.ts          # Zod schemas, input/output types, service interface
      router.ts         # tRPC router accepting a service implementation
    billing/
      types.ts
      router.ts
```

The router accepts a service implementation and delegates all calls to it — no business logic. The service interface defines the contract: method signatures the server must implement.

The naming convention for service interfaces is flexible (e.g., `*Service`, `*Context`, or any other pattern). What matters is consistency within the project — file names, interface names, and variable names should all agree.

### Server Package — Module Implementation

Each module in the server package contains the full three-layer stack:

```
packages/server/src/
  modules/
    identity/
      routers/          # Validation layer — tRPC + Zod
      services/         # Application layer — business services
      domain/           # Domain layer — pure TypeScript
        events/         # Domain events owned by this module
      index.ts          # Public API — the module boundary
    billing/
      routers/
      services/
      domain/
        events/
      index.ts
    orders/
      routers/
      services/
      domain/
        events/
      index.ts
```

The server package implements the service interfaces defined in the contract package. The three-layer structure (see [slice-composition.md](slice-composition.md)) applies here, where actual business logic lives.

### Intra-Module Rules

Within a module, the standard layer rules apply (see [slice-composition.md](slice-composition.md)):

```
routers → services → domain
```

- Routers delegate to services.
- Services coordinate domain objects.
- Domain has zero external dependencies.

### Module Public API (`index.ts`)

Every module has an `index.ts` at its root. This is the **only** entry point other modules may import from. It exports:

- **Domain event types** (as TypeScript types)
- **Domain event type guards** (for narrowing events in subscribers)

Nothing else leaks out. The module's routers, services, entities, value objects, and aggregates are private.

```typescript
// modules/orders/index.ts
export { type OrderPlaced, isOrderPlaced } from './domain/events/OrderPlaced.js';
export { type OrderCancelled, isOrderCancelled } from './domain/events/OrderCancelled.js';
```

## Topics

- **[Module Boundaries](module-boundaries.md)** — How bounded contexts stay loosely coupled. Domain events as the sole inter-module communication mechanism, event ownership, subscribing, dependency direction, and what cross-module imports are forbidden.

## Identifying Bounded Contexts

When designing modules, ask:

1. **Does this area have its own language?** If the team uses different words or the same words with different meanings, it is likely a separate bounded context.
2. **Can this area change independently?** If changes to billing logic should not require changes to shipping logic, they belong in separate modules.
3. **Does this area have its own invariants?** If a set of business rules are cohesive and self-contained, they likely form a bounded context.

Start with fewer, larger modules and split when the language or invariants diverge. Premature splitting creates unnecessary event plumbing.
