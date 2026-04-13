import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "db";
import { channels } from "db";
import type { ChannelConfig } from "api-server-api";
import { ChannelType } from "api-server-api";

function toChannelConfig(row: { type: string; config: unknown }): ChannelConfig {
  const config = row.config as Record<string, unknown>;
  return { type: row.type as ChannelType, ...config } as ChannelConfig;
}

export function listChannelsByOwner(db: Db, owner: string) {
  return async (): Promise<Map<string, ChannelConfig[]>> => {
    const rows = await db.select().from(channels).where(eq(channels.owner, owner));
    const map = new Map<string, ChannelConfig[]>();
    for (const row of rows) {
      const list = map.get(row.instanceId) ?? [];
      list.push(toChannelConfig(row));
      map.set(row.instanceId, list);
    }
    return map;
  };
}

export function listChannelsByInstance(db: Db, owner: string) {
  return async (instanceId: string): Promise<ChannelConfig[]> => {
    const rows = await db
      .select()
      .from(channels)
      .where(and(eq(channels.instanceId, instanceId), eq(channels.owner, owner)));
    return rows.map(toChannelConfig);
  };
}

export function upsertChannel(db: Db, owner: string) {
  return async (instanceId: string, channel: ChannelConfig): Promise<void> => {
    const { type, ...config } = channel;
    await db
      .insert(channels)
      .values({ instanceId, owner, type, config })
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

export function deleteChannelsByInstanceIds(db: Db) {
  return async (instanceIds: string[]): Promise<void> => {
    if (instanceIds.length === 0) return;
    await db.delete(channels).where(inArray(channels.instanceId, instanceIds));
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
