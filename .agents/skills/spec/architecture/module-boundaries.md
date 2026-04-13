# Module Boundaries

Bounded contexts must stay loosely coupled. No module may import another module's internals (services, entities, routers). The only cross-module imports allowed are event types and type guards from a module's `index.ts`.

Modules communicate exclusively through **domain events** — records of something meaningful that happened in the domain, named in past tense using business language: `OrderPlaced`, `UserRegistered`, `PaymentCompleted`.

## Event Ownership

Events are defined in the **publishing module's** domain layer:

```
modules/orders/domain/events/OrderPlaced.ts
```

The publishing module is the single source of truth for the event's shape.

## Event Structure

```typescript
// modules/orders/domain/events/OrderPlaced.ts
type OrderPlaced = {
  type: 'OrderPlaced';
  orderId: string;
  items: ReadonlyArray<OrderItem>;
};

const isOrderPlaced = (event: DomainEvent): event is OrderPlaced =>
  event.type === 'OrderPlaced';
```

Every event has a `type` discriminant and a corresponding type guard.

## Subscribing

A subscribing module imports only the event type and type guard from the publisher's `index.ts`:

```typescript
// modules/shipping/services/onOrderPlaced.ts
import { type OrderPlaced, isOrderPlaced } from '../../orders/index.js';
```

The subscriber knows about the event shape but nothing else about the publishing module's internals.

## Dependency Direction

```
orders  ──emits──▶  OrderPlaced
                         ▲
shipping ──subscribes────┘
```

- The publishing module (`orders`) knows nothing about its subscribers.
- The subscribing module (`shipping`) depends on the event type from `orders/index.ts`.
- This is a one-way dependency on a stable contract (the event shape), not on implementation details.

## What Is Not Allowed

- Importing a service from another module (`import { createUser } from '../identity/services/...'`)
- Importing a domain entity from another module (`import { User } from '../identity/domain/...'`)
- Importing a router from another module
- Any import that bypasses `index.ts`
