import type { ChannelConfig, ChannelType, InstancesService } from "api-server-api";

export interface ChannelManagerOptions {
  instances: () => InstancesService;
}

export interface ChannelManager {
  type: ChannelType;
  start(instanceName: string, channel: ChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
}
