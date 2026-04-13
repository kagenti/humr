export type SlackConnected = {
  type: "SlackConnected";
  instanceId: string;
  botToken: string;
};

export const isSlackConnected = (event: { type: string }): event is SlackConnected =>
  event.type === "SlackConnected";
