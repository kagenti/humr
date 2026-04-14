import { Subject, type Observable } from "rxjs";
import { filter } from "rxjs/operators";

// ---------------------------------------------------------------------------
// Domain events — write-side only
// ---------------------------------------------------------------------------

export type InstanceCreated = {
  type: "InstanceCreated";
  instanceId: string;
  agentId: string;
};

export type InstanceUpdated = {
  type: "InstanceUpdated";
  instanceId: string;
};

export type InstanceDeleted = {
  type: "InstanceDeleted";
  instanceId: string;
};

export type InstanceWoken = {
  type: "InstanceWoken";
  instanceId: string;
};

export type SlackConnected = {
  type: "SlackConnected";
  instanceId: string;
  botToken: string;
};

export type SlackDisconnected = {
  type: "SlackDisconnected";
  instanceId: string;
};

export type DomainEvent =
  | InstanceCreated
  | InstanceUpdated
  | InstanceDeleted
  | InstanceWoken
  | SlackConnected
  | SlackDisconnected;

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------

const bus$ = new Subject<DomainEvent>();

export function emit(event: DomainEvent): void {
  bus$.next(event);
}

export function events$(): Observable<DomainEvent> {
  return bus$.asObservable();
}

export function ofType<T extends DomainEvent>(type: T["type"]) {
  return (source: Observable<DomainEvent>): Observable<T> =>
    source.pipe(filter((e): e is T => e.type === type));
}
