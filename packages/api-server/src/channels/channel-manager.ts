import type { ChannelConfig, ChannelType } from "api-server-api";

export interface ChannelManager {
  type: ChannelType;
  start(instanceName: string, channel: ChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
}
