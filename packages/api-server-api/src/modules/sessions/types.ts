export const SessionType = {
  Regular: "regular",
  ChannelSlack: "channel_slack",
} as const;

export type SessionType = (typeof SessionType)[keyof typeof SessionType];

export interface SessionView {
  sessionId: string;
  instanceId: string;
  type: SessionType;
  createdAt: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface SessionsService {
  list(instanceId: string, includeChannel?: boolean): Promise<SessionView[]>;
  create(sessionId: string, instanceId: string, type?: SessionType): Promise<void>;
}
