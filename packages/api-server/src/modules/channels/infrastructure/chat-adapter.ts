export interface InboundMessage {
  externalUserId: string;
  text: string;
  reply(text: string): Promise<void>;
}

export interface ChatAdapter {
  provider: "slack" | "telegram";
  start(onMessage: (msg: InboundMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  sendMessage(text: string): Promise<void>;
}
