import type { Db } from "db";
import { sessions, eq, desc } from "db";
import { SessionType } from "api-server-api";

export function listSessionsByInstance(db: Db) {
  return async (instanceId: string) => {
    return db
      .select()
      .from(sessions)
      .where(eq(sessions.instanceId, instanceId))
      .orderBy(desc(sessions.createdAt));
  };
}

export function upsertSession(db: Db) {
  return async (sessionId: string, instanceId: string, type: SessionType = SessionType.Regular) => {
    await db
      .insert(sessions)
      .values({ sessionId, instanceId, type })
      .onConflictDoNothing();
  };
}
