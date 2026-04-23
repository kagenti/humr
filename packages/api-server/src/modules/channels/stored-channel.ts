import { ChannelType, type SlackChannel } from "api-server-api";

export interface StoredTelegramChannel {
  type: ChannelType.Telegram;
  botToken: string;
}

export type StoredChannelConfig = SlackChannel | StoredTelegramChannel;
