export type SlackDisconnected = {
  type: "SlackDisconnected";
  instanceId: string;
};

export const isSlackDisconnected = (event: { type: string }): event is SlackDisconnected =>
  event.type === "SlackDisconnected";
