import type { ChannelType } from "./instances.js";

export interface ChannelsContext {
  available: Partial<Record<ChannelType, boolean>>;
}
