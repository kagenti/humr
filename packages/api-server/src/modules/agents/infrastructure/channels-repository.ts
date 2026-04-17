import type { Db } from "db";
import { channels, eq, and, inArray } from "db";
import { ChannelType } from "api-server-api";
import {
  decryptStoredConfig,
  encryptStoredConfig,
  type StoredChannelConfig,
} from "../../channels/domain/stored-channel-config.js";

export function listChannelsByOwner(db: Db, owner: string) {
  return async (): Promise<Map<string, StoredChannelConfig[]>> => {
    const condition = owner ? eq(channels.owner, owner) : undefined;
    const rows = await db.select().from(channels).where(condition);
    const map = new Map<string, StoredChannelConfig[]>();
    for (const row of rows) {
      const list = map.get(row.instanceId) ?? [];
      list.push(decryptStoredConfig(row.type, row.config as Record<string, unknown>));
      map.set(row.instanceId, list);
    }
    return map;
  };
}

export function listChannelsByInstance(db: Db, owner: string) {
  return async (instanceId: string): Promise<StoredChannelConfig[]> => {
    const rows = await db
      .select()
      .from(channels)
      .where(and(eq(channels.instanceId, instanceId), eq(channels.owner, owner)));
    return rows.map((row) => decryptStoredConfig(row.type, row.config as Record<string, unknown>));
  };
}

export function upsertChannel(db: Db, owner: string) {
  return async (instanceId: string, channel: StoredChannelConfig): Promise<void> => {
    const config = encryptStoredConfig(channel);
    await db
      .insert(channels)
      .values({ instanceId, owner, type: channel.type, config })
      .onConflictDoUpdate({
        target: [channels.instanceId, channels.type],
        set: { config, owner },
      });
  };
}

export function deleteChannelsByInstance(db: Db) {
  return async (instanceId: string): Promise<void> => {
    await db.delete(channels).where(eq(channels.instanceId, instanceId));
  };
}

export function deleteChannelByType(db: Db, owner: string) {
  return async (instanceId: string, type: ChannelType): Promise<void> => {
    await db
      .delete(channels)
      .where(
        and(
          eq(channels.instanceId, instanceId),
          eq(channels.owner, owner),
          eq(channels.type, type),
        ),
      );
  };
}

export function deleteChannelsByInstanceIds(db: Db, owner: string) {
  return async (instanceIds: string[]): Promise<void> => {
    if (instanceIds.length === 0) return;
    const condition = owner
      ? and(inArray(channels.instanceId, instanceIds), eq(channels.owner, owner))
      : inArray(channels.instanceId, instanceIds);
    await db.delete(channels).where(condition);
  };
}

export function allChannelInstanceIds(db: Db) {
  return async (): Promise<string[]> => {
    const rows = await db
      .selectDistinct({ instanceId: channels.instanceId })
      .from(channels);
    return rows.map((r) => r.instanceId);
  };
}
