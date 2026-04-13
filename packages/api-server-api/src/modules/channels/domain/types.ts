import type { ChannelType } from "../../../shared/domain/types.js";

export type ChannelAvailability = Partial<Record<ChannelType, boolean>>;
