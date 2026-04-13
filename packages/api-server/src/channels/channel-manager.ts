import type { ChannelConfig, ChannelType, InstancesContext } from "api-server-api";

export interface ChannelManagerOptions {
  instances: () => InstancesContext;
}

export interface ChannelManager {
  type: ChannelType;
  start(instanceName: string, channel: ChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
}
