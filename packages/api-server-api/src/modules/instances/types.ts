import { type EnvVar, ChannelType, type UnifiedBackend } from "../shared.js";

export { ChannelType, type UnifiedBackend };

export interface Channel {
  type: ChannelType;
}

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  slackChannelId: string;
}

export interface TelegramChannel extends Channel {
  type: ChannelType.Telegram;
  telegramChatId: string;
}

export interface UnifiedChannel extends Channel {
  type: ChannelType.Unified;
  backend: UnifiedBackend;
  slackChannelId?: string;
  telegramChatId?: string;
}

export type ChannelConfig = SlackChannel | TelegramChannel | UnifiedChannel;

export interface ConnectTelegramInput {
  botToken: string;
  telegramChatId: string;
}

export interface ConnectUnifiedInput {
  backend: UnifiedBackend;
  slackBotToken?: string;
  slackAppToken?: string;
  slackChannelId?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export type InstanceState = "starting" | "running" | "hibernating" | "hibernated" | "error";

export interface Instance {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  state: InstanceState;
  error?: string;
  channels: ChannelConfig[];
  allowedUsers: string[];
}

export interface CreateInstanceInput {
  name: string;
  agentId: string;
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  allowedUsers?: string[];
}

export interface UpdateInstanceInput {
  id: string;
  env?: EnvVar[];
  secretRef?: string;
  allowedUsers?: string[];
}

export interface InstancesService {
  list: () => Promise<Instance[]>;
  get: (id: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (id: string) => Promise<void>;
  wake: (id: string) => Promise<Instance | null>;
  connectSlack: (id: string, slackChannelId: string) => Promise<Instance | null>;
  disconnectSlack: (id: string) => Promise<Instance | null>;
  connectTelegram: (id: string, input: ConnectTelegramInput) => Promise<Instance | null>;
  disconnectTelegram: (id: string) => Promise<Instance | null>;
  connectUnified: (id: string, input: ConnectUnifiedInput) => Promise<Instance | null>;
  disconnectUnified: (id: string) => Promise<Instance | null>;
}
