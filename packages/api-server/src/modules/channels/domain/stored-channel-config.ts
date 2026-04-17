import { ChannelType, type ChannelConfig, type UnifiedBackend } from "api-server-api";
import { decryptSecret, encryptSecret } from "../../../crypto/channel-secrets.js";

export interface StoredSlackChannel {
  type: ChannelType.Slack;
  slackChannelId: string;
}

export interface StoredTelegramChannel {
  type: ChannelType.Telegram;
  telegramChatId: string;
  botToken: string;
}

export interface StoredUnifiedChannel {
  type: ChannelType.Unified;
  backend: UnifiedBackend;
  slackChannelId?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  telegramChatId?: string;
  telegramBotToken?: string;
}

export type StoredChannelConfig =
  | StoredSlackChannel
  | StoredTelegramChannel
  | StoredUnifiedChannel;

export function encryptStoredConfig(stored: StoredChannelConfig): Record<string, unknown> {
  switch (stored.type) {
    case ChannelType.Slack:
      return { slackChannelId: stored.slackChannelId };
    case ChannelType.Telegram:
      return {
        telegramChatId: stored.telegramChatId,
        botToken: encryptSecret(stored.botToken),
      };
    case ChannelType.Unified: {
      const out: Record<string, unknown> = { backend: stored.backend };
      if (stored.slackChannelId !== undefined) out.slackChannelId = stored.slackChannelId;
      if (stored.slackBotToken !== undefined) out.slackBotToken = encryptSecret(stored.slackBotToken);
      if (stored.slackAppToken !== undefined) out.slackAppToken = encryptSecret(stored.slackAppToken);
      if (stored.telegramChatId !== undefined) out.telegramChatId = stored.telegramChatId;
      if (stored.telegramBotToken !== undefined) out.telegramBotToken = encryptSecret(stored.telegramBotToken);
      return out;
    }
  }
}

export function decryptStoredConfig(type: string, row: Record<string, unknown>): StoredChannelConfig {
  switch (type) {
    case ChannelType.Slack:
      return { type: ChannelType.Slack, slackChannelId: String(row.slackChannelId ?? "") };
    case ChannelType.Telegram:
      return {
        type: ChannelType.Telegram,
        telegramChatId: String(row.telegramChatId ?? ""),
        botToken: decryptSecret(String(row.botToken ?? "")),
      };
    case ChannelType.Unified: {
      const out: StoredUnifiedChannel = {
        type: ChannelType.Unified,
        backend: (row.backend as UnifiedBackend) ?? "slack",
      };
      if (row.slackChannelId !== undefined) out.slackChannelId = String(row.slackChannelId);
      if (row.slackBotToken !== undefined) out.slackBotToken = decryptSecret(String(row.slackBotToken));
      if (row.slackAppToken !== undefined) out.slackAppToken = decryptSecret(String(row.slackAppToken));
      if (row.telegramChatId !== undefined) out.telegramChatId = String(row.telegramChatId);
      if (row.telegramBotToken !== undefined) out.telegramBotToken = decryptSecret(String(row.telegramBotToken));
      return out;
    }
    default:
      throw new Error(`unknown channel type: ${type}`);
  }
}

export function toPublicChannel(stored: StoredChannelConfig): ChannelConfig {
  switch (stored.type) {
    case ChannelType.Slack:
      return { type: ChannelType.Slack, slackChannelId: stored.slackChannelId };
    case ChannelType.Telegram:
      return { type: ChannelType.Telegram, telegramChatId: stored.telegramChatId };
    case ChannelType.Unified:
      return {
        type: ChannelType.Unified,
        backend: stored.backend,
        slackChannelId: stored.slackChannelId,
        telegramChatId: stored.telegramChatId,
      };
  }
}
