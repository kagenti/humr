import {
  EventType,
  type DomainEvent,
  type ForkReady,
  type ForkFailed,
  type ForkCompleted,
} from "../../../events.js";

export function isForkReady(event: DomainEvent): event is ForkReady {
  return event.type === EventType.ForkReady;
}

export function isForkFailed(event: DomainEvent): event is ForkFailed {
  return event.type === EventType.ForkFailed;
}

export function isForkCompleted(event: DomainEvent): event is ForkCompleted {
  return event.type === EventType.ForkCompleted;
}
