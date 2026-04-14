import type { Db } from "db";
import { sessions, eq, desc } from "db";

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
  return async (sessionId: string, instanceId: string, type: string = "regular") => {
    await db
      .insert(sessions)
      .values({ sessionId, instanceId, type })
      .onConflictDoNothing();
  };
}
