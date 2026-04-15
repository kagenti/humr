import type { ChannelType } from "../shared.js";

export interface LinkedUser {
  keycloakSub: string;
  username: string | null;
}

export interface ChannelsService {
  available: Partial<Record<ChannelType, boolean>>;
  linkedUsers: () => Promise<LinkedUser[]>;
}
