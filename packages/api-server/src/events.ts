import { Subject, type Observable } from "rxjs";
import { filter } from "rxjs/operators";

// ---------------------------------------------------------------------------
// Domain events — write-side only
// ---------------------------------------------------------------------------

export enum EventType {
  UserAuthenticated = "UserAuthenticated",
  InstanceCreated = "InstanceCreated",
  InstanceUpdated = "InstanceUpdated",
  InstanceDeleted = "InstanceDeleted",
  InstanceRestarted = "InstanceRestarted",
  InstanceWoken = "InstanceWoken",
  SlackConnected = "SlackConnected",
  SlackDisconnected = "SlackDisconnected",
  TelegramConnected = "TelegramConnected",
  TelegramDisconnected = "TelegramDisconnected",
  ForkReady = "ForkReady",
  ForkFailed = "ForkFailed",
  ForkCompleted = "ForkCompleted",
  ForeignReplyReceived = "ForeignReplyReceived",
  SlackTurnRelayed = "SlackTurnRelayed",
}

export type UserAuthenticated = {
  type: EventType.UserAuthenticated;
  userSub: string;
  userJwt: string;
};

export type InstanceCreated = {
  type: EventType.InstanceCreated;
  instanceId: string;
  agentId: string;
};

export type InstanceUpdated = {
  type: EventType.InstanceUpdated;
  instanceId: string;
};

export type InstanceDeleted = {
  type: EventType.InstanceDeleted;
  instanceId: string;
};

export type InstanceRestarted = {
  type: EventType.InstanceRestarted;
  instanceId: string;
};

export type InstanceWoken = {
  type: EventType.InstanceWoken;
  instanceId: string;
};

export type SlackConnected = {
  type: EventType.SlackConnected;
  instanceId: string;
  slackChannelId: string;
};

export type SlackDisconnected = {
  type: EventType.SlackDisconnected;
  instanceId: string;
};

export type TelegramConnected = {
  type: EventType.TelegramConnected;
  instanceId: string;
};

export type TelegramDisconnected = {
  type: EventType.TelegramDisconnected;
  instanceId: string;
};

export type ForkFailureReason =
  | "CredentialMintFailed"
  | "OrchestrationFailed"
  | "PodNotReady"
  | "Timeout";

export type ForkReady = {
  type: EventType.ForkReady;
  forkId: string;
  replyId: string;
  podIP: string;
};

export type ForkFailed = {
  type: EventType.ForkFailed;
  forkId: string;
  replyId: string;
  reason: ForkFailureReason;
  detail?: string;
};

export type ForkCompleted = {
  type: EventType.ForkCompleted;
  forkId: string;
};

export type ForeignReplyReceived = {
  type: EventType.ForeignReplyReceived;
  replyId: string;
  instanceId: string;
  foreignSub: string;
  threadTs: string;
  sessionId?: string;
  prompt: string;
  slackContext: {
    channelId: string;
    userSlackId: string;
  };
};

export type SlackTurnRelayed = {
  type: EventType.SlackTurnRelayed;
  replyId: string;
  forkId?: string;
};

export type DomainEvent =
  | UserAuthenticated
  | InstanceCreated
  | InstanceUpdated
  | InstanceDeleted
  | InstanceRestarted
  | InstanceWoken
  | SlackConnected
  | SlackDisconnected
  | TelegramConnected
  | TelegramDisconnected
  | ForkReady
  | ForkFailed
  | ForkCompleted
  | ForeignReplyReceived
  | SlackTurnRelayed;

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
